# nazboard

nazboard is a lightweight, read-only web dashboard for at-a-glance ZFS pool,
dataset, snapshot, and device status.

It serves a Vite React interface and JSON API from a small TypeScript Node.js
HTTP server. The server uses Node built-ins, runs six fixed OpenZFS commands,
and never accepts command arguments from the browser.

## Screenshots

### Overview

![nazboard overview](docs/screenshot-overview.png)

### Pool

![nazboard pool details](docs/screenshot-pool.png)

### Dataset

![nazboard dataset details](docs/screenshot-dataset.png)

## Run with Docker

The host must have working ZFS kernel support. The image includes
`zfsutils-linux`, but it still needs access to the host's `/dev/zfs` device.

Build the image:

```sh
docker build -t nazboard:dev .
```

Run it on a ZFS host with a read-only root filesystem and no ambient Linux
capabilities:

```sh
docker run --rm \
  --name nazboard \
  -p 127.0.0.1:8080:8080 \
  --device /dev/zfs \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 100 \
  nazboard:dev
```

Open <http://localhost:8080>. The image includes a health check backed by
`GET /healthz`.

The process runs as UID/GID `10001`. Device permissions differ across hosts;
some ZFS/container combinations may require adjusted `/dev/zfs` ownership or
more privileged container settings. Add privileges only when the host requires
them. To expose the dashboard beyond the host, change the published address and
put authentication and TLS at a trusted reverse proxy.

## How it works

`GET /api/status` returns:

- `overall`: complete status availability and pool health
- `issues`: command, pool, vdev, disk, and dataset warnings or errors
- `pools`: capacity, topology, nested datasets, properties, and snapshots
- `commands`: the fixed commands and their unmodified text output

The server runs these commands with `child_process.execFile` and fixed argument
arrays:

```sh
zpool status -x
zpool list -H -p -o name,size,alloc,free,health
zpool status
zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots
zfs list -H -p -t snapshot -o name,used,refer,creation
zfs get -H -p -t filesystem,volume,snapshot -o name,property,value,source all
```

Successful and failed command results are cached in memory for one minute, and
concurrent requests share the same in-flight command executions. Nothing is
written to disk. Each command has a five-second timeout and a bounded output
buffer.

OpenZFS defines a snapshot's `used` value as space unique to that snapshot.
Because snapshots can share blocks, nazboard uses each dataset's
`usedbysnapshots` value for the aggregate space held by all of its snapshots.
The `zfs get` call returns all matching objects in one invocation; nazboard
groups the tab-separated rows by their `name` column.

The frontend and backend share one TypeScript definition for the JSON contract.
Command output is serialized as JSON and rendered by React as text, never as
HTML.

## Configuration

The server supports these environment variables:

| Variable               | Default                    | Purpose                                                        |
| ---------------------- | -------------------------- | -------------------------------------------------------------- |
| `PORT`                 | `8080`                     | HTTP listen port, from 1 to 65535                              |
| `NAZBOARD_DIST_DIR`    | `<working directory>/dist` | Static frontend directory                                      |
| `NAZBOARD_FIXTURE_DIR` | unset                      | Read command fixtures from a directory instead of invoking ZFS |

`NAZBOARD_FIXTURE_DIR` is intended for development and screenshots. Do not set
it in a real deployment.

## Security model

nazboard is intentionally small and read-only, but its status data can still be
sensitive:

- It exposes raw command output, dataset names, device identifiers, mountpoints,
  and every property returned by `zfs get all`.
- It implements no authentication, authorization, or TLS. Restrict it to trusted
  administrators or place it behind controls that provide them.
- It exposes no ZFS write/control endpoint and accepts no browser input for
  command execution.
- It uses fixed `execFile` argument lists rather than a shell.
- Responses include a restrictive content security policy, clickjacking,
  MIME-sniffing, referrer, cross-origin, and permissions-policy headers.
- The container runs as a fixed non-root user and supports a read-only root
  filesystem.

The Node base image and GitHub Actions are pinned to immutable digests or commit
references. The publish workflow uses least-privilege job permissions, CI
gating, dependency auditing, build caching, and BuildKit provenance and SBOM
attestations. Dependabot tracks npm, GitHub Actions, and Docker updates.

## Development

Node.js 22 or later and npm are required.

Install dependencies and run the complete local quality gate:

```sh
npm ci
npm run check
```

The quality gate checks formatting and linting, runs the tests, type-checks the
server, tests, shared contract, and frontend, and produces the production build.
The `tsc` binary uses the TypeScript 7 native compiler. The TypeScript 6
compatibility package remains installed alongside it because `typescript-eslint`
still requires the compiler's programmatic API.
Individual commands are also available:

```sh
npm test
npm run lint
npm run format
npm run build
```

Run the built server with the redacted example fixtures:

```sh
NAZBOARD_FIXTURE_DIR=tests npm start
```

For frontend-only development, run `npm run dev`. The interface refreshes every
60 seconds. Press `D` to switch between light and dark mode and `Ctrl+B` (or
`Cmd+B`) to toggle navigation.

### Test fixtures

On a machine with ZFS, refresh the fixture files with:

```sh
./scripts/generate-test-data.sh
```

The generator captures all six commands into a private staging directory and
replaces the fixtures only after every command succeeds. It redacts leaf device
paths and serial-based names from both `zpool status` outputs by default. Pool,
dataset, mountpoint, and other host-specific values may remain, so review every
fixture before committing it.

To capture elsewhere first or intentionally retain device names:

```sh
./scripts/generate-test-data.sh --output-dir /tmp/nazboard-test-data
./scripts/generate-test-data.sh --no-redact-device-names
```

To regenerate the checked-in screenshots after a build, run
`./scripts/capture-screenshots.sh`; it requires `curl` and Chrome or Chromium.

## Publishing

`.github/workflows/publish.yml` runs the complete quality gate for pull requests
and relevant pushes. After a successful push to `main` or a `v*.*.*` tag, it
publishes the container to `ghcr.io/<owner>/nazboard` with branch, commit,
semantic-version, and `latest` tags as applicable.

Pull requests generate fresh UI screenshots and display them in a single
automatically updated review comment; timestamp differences never fail the
pipeline. Pushes to `main` separately refresh the checked-in README screenshots.

## License

nazboard is released under the MIT License. See [LICENSE](LICENSE).
