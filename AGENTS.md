# AGENTS.md

## Project overview
nazboard is a tiny read-only ZFS status dashboard. It serves a Python standard library HTTP application that shells out to fixed `zpool` and `zfs` commands and renders escaped command output as HTML.

## Constraints
- Keep dependencies minimal.
- Prefer the Python standard library.
- Do not add Flask, FastAPI, Node.js, or frontend frameworks.
- Do not add write, repair, destroy, import/export, snapshot, or other control operations for ZFS.
- The dashboard must stay read-only and must not accept user input through the web UI.
- Avoid `shell=True`; use fixed argument lists with `subprocess.run`.
- Escape all command output before rendering HTML.
- Keep CSS embedded in the generated HTML unless there is a strong reason to change it.

## Test and build commands
- `python -m py_compile app/nazboard.py`
- `docker build .`

## Docker
Build locally with:

```sh
docker build -t nazboard:dev .
```

Run locally on a ZFS host with:

```sh
docker run --rm -p 8080:8080 --device /dev/zfs --read-only nazboard:dev
```

## Security expectations
- Keep nazboard read-only.
- Run as non-root where possible.
- Support read-only root filesystems.
- Document that `/dev/zfs` access is required and that privileged container settings may be required for some host/container setups.
