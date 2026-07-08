# nazboard

nazboard is a very lightweight, read-only web dashboard for at-a-glance ZFS pool and dataset status.

It uses only the Python standard library, serves a small dark-themed HTML page on port `8080`, and runs fixed `zpool`/`zfs` commands without accepting web UI input.

## Example output

```text
nazboard
Read-only ZFS status dashboard. Auto-refreshes every 60 seconds.

Overall: All pools are healthy

$ zpool status -x
all pools are healthy

$ zpool list -H -o name,size,alloc,free,health
...

$ zpool status
...

$ zfs list -o name,used,avail,refer,mountpoint
...
```

> Screenshot placeholder: add `docs/screenshot.png` after deploying against a real ZFS host.

## ZFS access caveat

nazboard reads ZFS status from the host kernel via `zpool` and `zfs`. The container image includes `zfsutils-linux`, but the host still needs working ZFS kernel support and the container must be able to access `/dev/zfs`.


## Local Docker usage

Build the image:

```sh
docker build -t nazboard:dev .
```

Run on a ZFS host:

```sh
docker run --rm \
  -p 8080:8080 \
  --device /dev/zfs \
  --read-only \
  nazboard:dev
```

Open <http://localhost:8080>. Health check endpoint: <http://localhost:8080/healthz>.

## Deployment beyond local Docker

If you run nazboard under an external orchestrator, provide equivalent container settings yourself: expose port `8080`, keep the filesystem read-only where possible, run as a non-root user, and pass through `/dev/zfs` so the bundled `zpool` and `zfs` tools can read host ZFS status. Some environments may require privileged container settings for ZFS device access.

## Security notes

- nazboard is read-only and exposes no forms or control endpoints.
- The web server ignores query strings and only serves `/` and `/healthz`.
- Command execution uses fixed argument lists and does not use `shell=True`.
- Command output is HTML-escaped before rendering.
- The container runs as UID/GID `10001` and supports a read-only root filesystem.
- Restrict network access to trusted administrators; nazboard does not implement authentication.

## Development

Run syntax checks:

```sh
python -m py_compile app/nazboard.py
```

Run locally without Docker:

```sh
python app/nazboard.py
```

## Release and publishing

The GitHub Actions workflow in `.github/workflows/publish.yml` publishes container images to:

```text
ghcr.io/<owner>/nazboard
```

It runs on pushes to `main` and tags matching `v*.*.*`. Image tags include branch tags, SHA tags, semantic version tags, and `latest` for the default branch.


## License

nazboard is released under the MIT License. See [LICENSE](LICENSE).
