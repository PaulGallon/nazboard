import importlib.util
import os
from contextlib import contextmanager
from pathlib import Path
from threading import Thread
from unittest import TestCase, main
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app" / "nazboard.py"


def load_app():
    spec = importlib.util.spec_from_file_location("nazboard", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@contextmanager
def run_test_server(app):
    server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class FixtureModeTests(TestCase):
    def test_render_page_uses_redacted_command_output(self):
        app = load_app()

        with patch.dict(os.environ, {app.FIXTURE_DIR_ENV: str(ROOT / "tests")}):
            page = app.render_page().decode("utf-8")

        self.assertIn("All pools are healthy", page)
        self.assertIn("storage01", page)
        self.assertIn("scsi-SATA_WDC_WD30EFRX-68A_WD-XXXXXXXXXXXX", page)
        self.assertIn("$ zpool status -x", page)
        self.assertIn('class="summary usage-pill error"', page)
        self.assertIn(
            '<span class="dot error"></span><strong>storage01</strong> 96% used',
            page,
        )
        self.assertNotIn("progressbar", page)

    def test_render_command_escapes_output(self):
        app = load_app()
        result = app.CommandResult(
            title="unsafe",
            command=("zpool", "status"),
            returncode=0,
            stdout="<script>alert(1)</script>",
            stderr="",
        )

        rendered = app.render_command(result)

        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", rendered)
        self.assertNotIn("<script>", rendered)

    def test_root_dataset_usage_only_includes_root_level_datasets(self):
        app = load_app()
        result = app.CommandResult(
            title="zfs list",
            command=("zfs", "list", "-o", "name,used,avail,refer,mountpoint"),
            returncode=0,
            stdout=(
                "NAME USED AVAIL REFER MOUNTPOINT\n"
                "tank 50G 50G 10G /tank\n"
                "tank/home 90G 10G 90G /tank/home\n"
                "backup 1T 3T 1T /backup\n"
            ),
            stderr="",
        )

        datasets = app.root_dataset_usage([result])

        self.assertEqual([dataset.name for dataset in datasets], ["tank", "backup"])
        self.assertEqual(datasets[0].used_percent, 50.0)
        self.assertEqual(datasets[1].used_percent, 25.0)

    def test_dataset_usage_threshold_classes(self):
        app = load_app()

        self.assertEqual(app.classify_dataset_usage(74.9), "ok")
        self.assertEqual(app.classify_dataset_usage(75.0), "warn")
        self.assertEqual(app.classify_dataset_usage(84.9), "warn")
        self.assertEqual(app.classify_dataset_usage(85.0), "error")


class SecurityAndRobustnessTests(TestCase):
    def test_run_command_forces_c_locale(self):
        app = load_app()

        completed = app.subprocess.CompletedProcess(
            args=("zpool", "status", "-x"), returncode=0, stdout="ok", stderr=""
        )
        with patch.object(app.shutil, "which", return_value="/usr/sbin/zpool"), patch.object(
            app.subprocess, "run", return_value=completed
        ) as run:
            app.run_command("health", ("zpool", "status", "-x"))

        self.assertEqual(run.call_args.kwargs["env"]["LC_ALL"], "C")
        self.assertEqual(run.call_args.kwargs["env"]["LANG"], "C")
        self.assertFalse(run.call_args.kwargs["check"])
        self.assertEqual(run.call_args.kwargs["timeout"], app.COMMAND_TIMEOUT_SECONDS)

    def test_truncate_output_adds_note_without_marking_command_ok_false(self):
        app = load_app()

        output, truncated = app.truncate_output("x" * (app.MAX_COMMAND_OUTPUT_CHARS + 1))

        self.assertTrue(truncated)
        self.assertTrue(output.endswith("\n... [truncated]"))
        self.assertLess(len(output), app.MAX_COMMAND_OUTPUT_CHARS + 20)

    def test_get_root_includes_security_headers(self):
        app = load_app()

        with patch.dict(os.environ, {app.FIXTURE_DIR_ENV: str(ROOT / "tests")}):
            with run_test_server(app) as base_url:
                response = urlopen(base_url + "/")
                body = response.read().decode("utf-8")

        self.assertEqual(response.status, 200)
        self.assertIn("nazboard", body)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertIn("default-src 'none'", response.headers["Content-Security-Policy"])

    def test_healthz_and_not_found_include_security_headers(self):
        app = load_app()

        with run_test_server(app) as base_url:
            health = urlopen(base_url + "/healthz")
            with self.assertRaises(HTTPError) as raised:
                urlopen(base_url + "/missing?ignored=<script>")

        self.assertEqual(health.status, 200)
        self.assertEqual(health.read(), b"ok\n")
        self.assertEqual(health.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(raised.exception.code, 404)
        self.assertEqual(raised.exception.headers["X-Content-Type-Options"], "nosniff")

    def test_unsupported_method_returns_405_without_body(self):
        app = load_app()

        with run_test_server(app) as base_url:
            request = Request(base_url + "/", method="POST")
            with self.assertRaises(HTTPError) as raised:
                urlopen(request)

        self.assertEqual(raised.exception.code, 405)
        self.assertEqual(raised.exception.headers["Allow"], "GET, HEAD")
        self.assertEqual(raised.exception.headers["Content-Length"], "0")


if __name__ == "__main__":
    main()
