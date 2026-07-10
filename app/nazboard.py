#!/usr/bin/env python3
"""nazboard: a tiny read-only ZFS status dashboard."""

from __future__ import annotations

import html
import os
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import NamedTuple
from urllib.parse import urlsplit

HOST = "0.0.0.0"
PORT = 8080
COMMAND_TIMEOUT_SECONDS = 5
MAX_COMMAND_OUTPUT_CHARS = 200_000
MAX_RENDER_CONCURRENCY = 4
FIXTURE_DIR_ENV = "NAZBOARD_FIXTURE_DIR"
COMMAND_ENV = {"LC_ALL": "C", "LANG": "C"}
SECURITY_HEADERS = (
    (
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    ("Cache-Control", "no-store"),
)
RENDER_SEMAPHORE = threading.BoundedSemaphore(MAX_RENDER_CONCURRENCY)


class CommandResult(NamedTuple):
    title: str
    command: tuple[str, ...]
    returncode: int | None
    stdout: str
    stderr: str
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and self.error is None


class DatasetUsage(NamedTuple):
    name: str
    used: float
    avail: float

    @property
    def used_percent(self) -> float:
        total = self.used + self.avail
        if total <= 0:
            return 0.0
        return max(0.0, min(100.0, (self.used / total) * 100.0))


COMMANDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ZFS health summary", ("zpool", "status", "-x")),
    ("zpool list", ("zpool", "list", "-H", "-o", "name,size,alloc,free,health")),
    ("zpool status", ("zpool", "status")),
    ("zfs list", ("zfs", "list", "-o", "name,used,avail,refer,mountpoint")),
)

FIXTURE_FILES: dict[tuple[str, ...], str] = {
    ("zpool", "status", "-x"): "zpool_status_x.txt",
    ("zpool", "list", "-H", "-o", "name,size,alloc,free,health"): "zpool_list.txt",
    ("zpool", "status"): "zpool_status.txt",
    ("zfs", "list", "-o", "name,used,avail,refer,mountpoint"): "zfs_list.txt",
}

SIZE_UNITS: dict[str, float] = {
    "B": 1.0,
    "K": 1024.0,
    "M": 1024.0**2,
    "G": 1024.0**3,
    "T": 1024.0**4,
    "P": 1024.0**5,
    "E": 1024.0**6,
}


def fixture_dir() -> Path | None:
    """Return the optional directory containing captured command output."""
    value = os.environ.get(FIXTURE_DIR_ENV)
    if not value:
        return None
    return Path(value)


def read_fixture(title: str, command: tuple[str, ...], directory: Path) -> CommandResult:
    """Read captured output for a fixed command from a developer-supplied directory."""
    filename = FIXTURE_FILES.get(command)
    if filename is None:
        return CommandResult(
            title=title,
            command=command,
            returncode=None,
            stdout="",
            stderr="",
            error="No fixture filename is configured for this command.",
        )

    path = directory / filename
    try:
        output = path.read_text(encoding="utf-8")
    except OSError as exc:
        return CommandResult(
            title=title,
            command=command,
            returncode=None,
            stdout="",
            stderr="",
            error=f"Failed to read fixture {path}: {exc}",
        )

    return CommandResult(
        title=title,
        command=command,
        returncode=0,
        stdout=output,
        stderr="",
    )


def run_command(title: str, command: tuple[str, ...]) -> CommandResult:
    """Run a fixed ZFS command without invoking a shell."""
    directory = fixture_dir()
    if directory is not None:
        return read_fixture(title, command, directory)

    executable = command[0]
    if shutil.which(executable) is None:
        return CommandResult(
            title=title,
            command=command,
            returncode=None,
            stdout="",
            stderr="",
            error=(
                f"{executable!r} was not found in PATH. Install zfsutils-linux "
                "or use the nazboard container image."
            ),
        )

    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            env=os.environ | COMMAND_ENV,
        )
    except subprocess.TimeoutExpired:
        return CommandResult(
            title=title,
            command=command,
            returncode=None,
            stdout="",
            stderr="",
            error=f"Command timed out after {COMMAND_TIMEOUT_SECONDS} seconds.",
        )
    except OSError as exc:
        return CommandResult(
            title=title,
            command=command,
            returncode=None,
            stdout="",
            stderr="",
            error=f"Failed to execute command: {exc}",
        )

    stdout, stdout_truncated = truncate_output(completed.stdout)
    stderr, stderr_truncated = truncate_output(completed.stderr)
    notes = []
    if stdout_truncated:
        notes.append(f"stdout truncated to {MAX_COMMAND_OUTPUT_CHARS} characters")
    if stderr_truncated:
        notes.append(f"stderr truncated to {MAX_COMMAND_OUTPUT_CHARS} characters")
    stderr = append_notes(stderr, notes)

    return CommandResult(
        title=title,
        command=command,
        returncode=completed.returncode,
        stdout=stdout,
        stderr=stderr,
    )


def truncate_output(output: str) -> tuple[str, bool]:
    """Limit command output rendered into a response."""
    if len(output) <= MAX_COMMAND_OUTPUT_CHARS:
        return output, False
    return output[:MAX_COMMAND_OUTPUT_CHARS] + "\n... [truncated]", True


def append_notes(output: str, notes: list[str]) -> str:
    if not notes:
        return output
    suffix = "\n".join(f"NOTE: {note}" for note in notes)
    if output:
        return f"{output.rstrip()}\n{suffix}\n"
    return f"{suffix}\n"


def classify_overall(results: list[CommandResult]) -> tuple[str, str]:
    health = results[0] if results else None
    if not health or health.error:
        return "error", "Unable to read ZFS health"
    combined = f"{health.stdout}\n{health.stderr}".lower()
    if health.returncode != 0:
        return "error", "ZFS health command failed"
    if "all pools are healthy" in combined:
        return "ok", "All pools are healthy"
    if "no pools available" in combined:
        return "warn", "No ZFS pools available"
    return "warn", "ZFS reports attention needed"


def parse_zfs_size(value: str) -> float | None:
    value = value.strip()
    if not value or value == "-":
        return None

    unit = value[-1].upper()
    multiplier = SIZE_UNITS.get(unit)
    number = value[:-1] if multiplier is not None else value
    if multiplier is None:
        multiplier = 1.0

    try:
        return float(number) * multiplier
    except ValueError:
        return None


def root_dataset_usage(results: list[CommandResult]) -> list[DatasetUsage]:
    zfs_list = next((result for result in results if result.title == "zfs list"), None)
    if not zfs_list or not zfs_list.ok:
        return []

    datasets = []
    for line in zfs_list.stdout.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 3 or parts[0].upper() == "NAME" or "/" in parts[0]:
            continue

        used = parse_zfs_size(parts[1])
        avail = parse_zfs_size(parts[2])
        if used is None or avail is None:
            continue

        datasets.append(DatasetUsage(parts[0], used, avail))
    return datasets


def classify_dataset_usage(percent: float) -> str:
    if percent >= 85.0:
        return "error"
    if percent >= 75.0:
        return "warn"
    return "ok"


def render_dataset_pills(datasets: list[DatasetUsage]) -> str:
    if not datasets:
        return ""

    pills = []
    for dataset in datasets:
        percent = dataset.used_percent
        percent_text = f"{percent:.0f}%"
        usage_state = classify_dataset_usage(percent)
        pills.append(
            f"""
      <span class=\"summary usage-pill {usage_state}\"><span class=\"dot {usage_state}\"></span><strong>{html.escape(dataset.name)}</strong> {html.escape(percent_text)} used</span>
            """
        )

    return "".join(pills)


def render_command(result: CommandResult) -> str:
    command = " ".join(result.command)
    status = "ok" if result.ok else "error"
    returncode = "not run" if result.returncode is None else str(result.returncode)
    parts = []
    if result.error:
        parts.append(f"ERROR: {result.error}")
    if result.stdout:
        parts.append(result.stdout.rstrip())
    if result.stderr:
        parts.append("STDERR:\n" + result.stderr.rstrip())
    if not parts:
        parts.append("(no output)")
    output = html.escape("\n\n".join(parts))
    return f"""
      <section class=\"card\">
        <div class=\"card-head\">
          <h2>{html.escape(result.title)}</h2>
          <span class=\"pill {status}\">exit {html.escape(returncode)}</span>
        </div>
        <p class=\"command\">$ {html.escape(command)}</p>
        <pre>{output}</pre>
      </section>
    """


def render_page() -> bytes:
    results = [run_command(title, command) for title, command in COMMANDS]
    state, message = classify_overall(results)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    dataset_pills = render_dataset_pills(root_dataset_usage(results))
    sections = "\n".join(render_command(result) for result in results)
    page = f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <meta http-equiv=\"refresh\" content=\"60\">
  <title>nazboard</title>
  <style>
    :root {{ color-scheme: dark; --bg:#0b1020; --panel:#121a2d; --text:#e6edf7; --muted:#9aa8bd; --ok:#3ddc84; --warn:#ffbf47; --error:#ff5d5d; --border:#263149; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); }}
    header {{ padding:2rem; border-bottom:1px solid var(--border); background:linear-gradient(135deg,#111a30,#0b1020); }}
    h1 {{ margin:0 0 .5rem; font-size:clamp(2rem,5vw,3.5rem); }}
    h2 {{ margin:0; font-size:1rem; }}
    .sub {{ color:var(--muted); margin:0; }}
    main {{ padding:1rem; display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(min(100%,34rem),1fr)); }}
    .summaries {{ display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; margin-top:1rem; }}
    .summary {{ display:inline-flex; gap:.75rem; align-items:center; margin-top:1rem; padding:.75rem 1rem; border:1px solid var(--border); border-radius:999px; background:var(--panel); }}
    .summaries .summary {{ margin-top:0; }}
    .usage-pill {{ color:var(--text); }}
    .usage-pill.ok {{ border-color:var(--ok); }}
    .usage-pill.warn {{ border-color:var(--warn); }}
    .usage-pill.error {{ border-color:var(--error); }}
    .dot {{ width:.85rem; height:.85rem; border-radius:50%; background:var(--muted); box-shadow:0 0 1rem currentColor; }}
    .ok {{ color:var(--ok); }} .warn {{ color:var(--warn); }} .error {{ color:var(--error); }}
    .dot.ok {{ background:var(--ok); }} .dot.warn {{ background:var(--warn); }} .dot.error {{ background:var(--error); }}
    .card {{ background:var(--panel); border:1px solid var(--border); border-radius:1rem; overflow:hidden; box-shadow:0 .75rem 2rem rgba(0,0,0,.25); }}
    .card-head {{ display:flex; justify-content:space-between; gap:1rem; align-items:center; padding:1rem; border-bottom:1px solid var(--border); }}
    .pill {{ border:1px solid currentColor; border-radius:999px; padding:.2rem .55rem; font-size:.8rem; white-space:nowrap; }}
    .command {{ margin:0; padding:.75rem 1rem 0; color:var(--muted); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.9rem; }}
    pre {{ margin:0; padding:1rem; overflow:auto; white-space:pre-wrap; word-break:break-word; font: .9rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
  </style>
</head>
<body>
  <header>
    <h1>nazboard</h1>
    <p class=\"sub\">Read-only ZFS status dashboard. Auto-refreshes every 60 seconds. Generated {html.escape(generated)}.</p>
    <div class=\"summaries\">
      <div class=\"summary\"><span class=\"dot {state}\"></span><strong class=\"{state}\">{html.escape(message)}</strong></div>
      {dataset_pills}
    </div>
  </header>
  <main>{sections}</main>
</body>
</html>"""
    return page.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "nazboard/0.1"

    def end_headers(self) -> None:
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)
        super().end_headers()

    def do_HEAD(self) -> None:
        self.handle_request(include_body=False)

    def do_GET(self) -> None:
        self.handle_request(include_body=True)

    def do_POST(self) -> None:
        self.reject_unsupported_method()

    def do_PUT(self) -> None:
        self.reject_unsupported_method()

    def do_DELETE(self) -> None:
        self.reject_unsupported_method()

    def do_PATCH(self) -> None:
        self.reject_unsupported_method()

    def reject_unsupported_method(self) -> None:
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_request(self, include_body: bool) -> None:
        path = urlsplit(self.path).path
        if path == "/healthz":
            body = b"ok\n"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if include_body:
                self.wfile.write(body)
            return
        if path != "/":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not RENDER_SEMAPHORE.acquire(blocking=False):
            body = b"busy\n"
            self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if include_body:
                self.wfile.write(body)
            return
        try:
            body = render_page()
        finally:
            RENDER_SEMAPHORE.release()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"nazboard listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
