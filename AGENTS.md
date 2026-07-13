# AGENTS.md

## Project overview
nazboard is a tiny read-only ZFS status dashboard. It serves a Vite React UI built with shadcn/ui and a small TypeScript Node HTTP server that shells out to fixed `zpool` and `zfs` commands.

## Constraints
- Keep dependencies minimal and purposeful.
- Use Node built-ins for the backend HTTP server, static file serving, filesystem access, and command execution unless there is a strong reason not to.
- React, Vite, TypeScript, shadcn/ui, Tailwind, Recharts, Base UI, and lucide-react are allowed for the UI.
- Do not add Express, Fastify, Flask, FastAPI, or additional server frameworks.
- Do not add write, repair, destroy, import/export, snapshot, or other control operations for ZFS.
- The dashboard must stay read-only and must not accept user input through the web UI for ZFS command execution.
- Avoid shell execution; use fixed argument lists with `child_process.execFile`.
- Render command output as text in React. Do not inject command output as HTML.
- Prefer shadcn components already installed in `src/components/ui` before adding custom UI.

## Test and build commands
- `npm test`
- `npm run build`
- During development, do not run Docker builds unless the user explicitly asks.

## Workflow
- Commit all completed changes before handing work back.

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
