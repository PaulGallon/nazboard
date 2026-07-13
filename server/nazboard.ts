import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const HOST = "0.0.0.0"
export const PORT = Number.parseInt(process.env.PORT ?? "8080", 10)
export const COMMAND_TIMEOUT_MS = 5000
export const FIXTURE_DIR_ENV = "NAZBOARD_FIXTURE_DIR"

type State = "ok" | "warn" | "error"

export type CommandResult = {
  title: string
  command: string[]
  returncode: number | null
  stdout: string
  stderr: string
  error: string | null
}

export type Issue = {
  severity: State
  scope: "overall" | "pool" | "dataset" | "command"
  name: string
  message: string
}

export type DatasetStatus = {
  name: string
  path: string
  used_bytes: number
  available_bytes: number
  refer_bytes: number | null
  mountpoint: string
  used_percent: number
  state: State
  children: DatasetStatus[]
}

export type PoolStatus = {
  name: string
  size_bytes: number
  allocated_bytes: number
  free_bytes: number
  health: string
  used_percent: number
  datasets: DatasetStatus[]
}

export type StatusPayload = {
  generated_at: string
  overall: {
    state: State
    message: string
  }
  issues: Issue[]
  pools: PoolStatus[]
  commands: CommandResult[]
}

const COMMANDS: Array<[string, string[]]> = [
  ["ZFS health summary", ["zpool", "status", "-x"]],
  ["zpool list", ["zpool", "list", "-H", "-o", "name,size,alloc,free,health"]],
  ["zpool status", ["zpool", "status"]],
  ["zfs list", ["zfs", "list", "-o", "name,used,avail,refer,mountpoint"]],
]

const FIXTURE_FILES = new Map<string, string>([
  [["zpool", "status", "-x"].join("\0"), "zpool_status_x.txt"],
  [
    ["zpool", "list", "-H", "-o", "name,size,alloc,free,health"].join("\0"),
    "zpool_list.txt",
  ],
  [["zpool", "status"].join("\0"), "zpool_status.txt"],
  [
    ["zfs", "list", "-o", "name,used,avail,refer,mountpoint"].join("\0"),
    "zfs_list.txt",
  ],
])

const SIZE_UNITS = new Map<string, number>([
  ["B", 1],
  ["K", 1024],
  ["M", 1024 ** 2],
  ["G", 1024 ** 3],
  ["T", 1024 ** 4],
  ["P", 1024 ** 5],
  ["E", 1024 ** 6],
])

const MIME_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

function commandKey(command: string[]) {
  return command.join("\0")
}

function commandOk(result: CommandResult) {
  return result.returncode === 0 && result.error === null
}

export async function readFixture(
  title: string,
  command: string[],
  directory: string
): Promise<CommandResult> {
  const filename = FIXTURE_FILES.get(commandKey(command))
  if (!filename) {
    return {
      title,
      command,
      returncode: null,
      stdout: "",
      stderr: "",
      error: "No fixture filename is configured for this command.",
    }
  }

  const path = join(directory, filename)
  try {
    return {
      title,
      command,
      returncode: 0,
      stdout: await readFile(path, "utf8"),
      stderr: "",
      error: null,
    }
  } catch (error) {
    return {
      title,
      command,
      returncode: null,
      stdout: "",
      stderr: "",
      error: `Failed to read fixture ${path}: ${String(error)}`,
    }
  }
}

export async function runCommand(
  title: string,
  command: string[]
): Promise<CommandResult> {
  const fixtureDir = process.env[FIXTURE_DIR_ENV]
  if (fixtureDir) {
    return readFixture(title, command, fixtureDir)
  }

  return new Promise((resolveCommand) => {
    execFile(
      command[0],
      command.slice(1),
      {
        encoding: "utf8",
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveCommand({
            title,
            command,
            returncode: 0,
            stdout,
            stderr,
            error: null,
          })
          return
        }

        if (typeof error.code === "number") {
          resolveCommand({
            title,
            command,
            returncode: error.code,
            stdout,
            stderr,
            error: null,
          })
          return
        }

        resolveCommand({
          title,
          command,
          returncode: null,
          stdout,
          stderr,
          error:
            "code" in error && error.code === "ENOENT"
              ? `'${command[0]}' was not found in PATH. Install zfsutils-linux or use the nazboard container image.`
              : error.killed && error.signal === "SIGTERM"
                ? `Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds.`
                : `Failed to execute command: ${error.message}`,
        })
      }
    )
  })
}

export function parseZfsSize(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-") {
    return null
  }

  const unit = trimmed.at(-1)?.toUpperCase() ?? ""
  const multiplier = SIZE_UNITS.get(unit)
  const numberText = multiplier ? trimmed.slice(0, -1) : trimmed
  const parsed = Number.parseFloat(numberText)

  if (Number.isNaN(parsed)) {
    return null
  }

  return parsed * (multiplier ?? 1)
}

export function usedPercent(used: number, available: number) {
  const total = used + available
  if (total <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, (used / total) * 100))
}

export function classifyUsage(percent: number): State {
  if (percent >= 85) {
    return "error"
  }
  if (percent >= 75) {
    return "warn"
  }
  return "ok"
}

export function classifyOverall(
  results: CommandResult[]
): StatusPayload["overall"] {
  const health = results[0]
  if (!health || health.error) {
    return { state: "error", message: "Unable to read ZFS health" }
  }

  const combined = `${health.stdout}\n${health.stderr}`.toLowerCase()
  if (health.returncode !== 0) {
    return { state: "error", message: "ZFS health command failed" }
  }
  if (combined.includes("all pools are healthy")) {
    return { state: "ok", message: "All pools are healthy" }
  }
  if (combined.includes("no pools available")) {
    return { state: "warn", message: "No ZFS pools available" }
  }

  return { state: "warn", message: "ZFS reports attention needed" }
}

export function parsePools(results: CommandResult[]): PoolStatus[] {
  const poolList = results.find((result) => result.title === "zpool list")
  if (!poolList || !commandOk(poolList)) {
    return []
  }

  return poolList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/)
      if (parts.length < 5) {
        return null
      }

      const [name, sizeText, allocatedText, freeText, health] = parts
      const size = parseZfsSize(sizeText)
      const allocated = parseZfsSize(allocatedText)
      const free = parseZfsSize(freeText)

      if (size === null || allocated === null || free === null) {
        return null
      }

      const pool: PoolStatus = {
        name,
        size_bytes: size,
        allocated_bytes: allocated,
        free_bytes: free,
        health,
        used_percent: usedPercent(allocated, free),
        datasets: [],
      }
      return pool
    })
    .filter((pool): pool is PoolStatus => pool !== null)
}

export function parseDatasets(results: CommandResult[]): DatasetStatus[] {
  const zfsList = results.find((result) => result.title === "zfs list")
  if (!zfsList || !commandOk(zfsList)) {
    return []
  }

  return zfsList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/, 5)
      if (parts.length < 5 || parts[0].toUpperCase() === "NAME") {
        return null
      }

      const used = parseZfsSize(parts[1])
      const available = parseZfsSize(parts[2])
      const refer = parseZfsSize(parts[3])
      if (used === null || available === null) {
        return null
      }

      const pathParts = parts[0].split("/")
      const percent = usedPercent(used, available)
      const dataset: DatasetStatus = {
        name: pathParts.at(-1) ?? parts[0],
        path: parts[0],
        used_bytes: used,
        available_bytes: available,
        refer_bytes: refer,
        mountpoint: parts[4],
        used_percent: percent,
        state: classifyUsage(percent),
        children: [],
      }
      return dataset
    })
    .filter((dataset): dataset is DatasetStatus => dataset !== null)
}

export function nestDatasets(datasets: DatasetStatus[]) {
  const byPath = new Map<string, DatasetStatus>()
  for (const dataset of datasets) {
    byPath.set(dataset.path, { ...dataset, children: [] })
  }

  const roots: DatasetStatus[] = []
  for (const dataset of byPath.values()) {
    const parentPath = dataset.path.includes("/")
      ? dataset.path.slice(0, dataset.path.lastIndexOf("/"))
      : null
    const parent = parentPath ? byPath.get(parentPath) : null
    if (parent) {
      parent.children.push(dataset)
    } else {
      roots.push(dataset)
    }
  }

  const sortTree = (items: DatasetStatus[]) => {
    items.sort((a, b) => a.path.localeCompare(b.path))
    for (const item of items) {
      sortTree(item.children)
    }
  }
  sortTree(roots)

  return roots
}

export function attachDatasetsToPools(
  pools: PoolStatus[],
  datasets: DatasetStatus[]
) {
  const datasetRoots = nestDatasets(datasets)
  const rootsByPool = new Map(
    datasetRoots.map((dataset) => [dataset.path.split("/")[0], dataset])
  )

  return pools.map((pool) => ({
    ...pool,
    datasets: rootsByPool.get(pool.name) ? [rootsByPool.get(pool.name)!] : [],
  }))
}

export function collectIssues(
  overall: StatusPayload["overall"],
  pools: PoolStatus[],
  commands: CommandResult[]
): Issue[] {
  const issues: Issue[] = []

  if (overall.state !== "ok") {
    issues.push({
      severity: overall.state,
      scope: "overall",
      name: "ZFS",
      message: overall.message,
    })
  }

  for (const command of commands) {
    if (!commandOk(command)) {
      issues.push({
        severity: "error",
        scope: "command",
        name: command.title,
        message: command.error ?? `Command exited with ${command.returncode}`,
      })
    }
  }

  const visitDataset = (dataset: DatasetStatus) => {
    if (dataset.state !== "ok") {
      issues.push({
        severity: dataset.state,
        scope: "dataset",
        name: dataset.path,
        message: `${dataset.used_percent.toFixed(0)}% used`,
      })
    }
    for (const child of dataset.children) {
      visitDataset(child)
    }
  }

  for (const pool of pools) {
    if (pool.health.toUpperCase() !== "ONLINE") {
      issues.push({
        severity: "error",
        scope: "pool",
        name: pool.name,
        message: `Pool health is ${pool.health}`,
      })
    }
    for (const dataset of pool.datasets) {
      visitDataset(dataset)
    }
  }

  return issues
}

export async function getStatus(): Promise<StatusPayload> {
  const commands = await Promise.all(
    COMMANDS.map(([title, command]) => runCommand(title, command))
  )
  const overall = classifyOverall(commands)
  const pools = attachDatasetsToPools(
    parsePools(commands),
    parseDatasets(commands)
  )

  return {
    generated_at: new Date().toISOString(),
    overall,
    issues: collectIssues(overall, pools, commands),
    pools,
    commands,
  }
}

function send(
  response: ServerResponse,
  statusCode: number,
  body: string | Buffer,
  contentType: string
) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  })
  response.end(body)
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown
) {
  send(
    response,
    statusCode,
    `${JSON.stringify(value)}\n`,
    "application/json; charset=utf-8"
  )
}

function distDirectory() {
  return resolve(process.env.NAZBOARD_DIST_DIR ?? join(process.cwd(), "dist"))
}

function staticFilePath(pathname: string) {
  const root = distDirectory()
  const relative =
    pathname === "/"
      ? "index.html"
      : decodeURIComponent(pathname).replace(/^\/+/, "")
  const candidate = normalize(join(root, relative))
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null
  }
  return candidate
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const filePath = staticFilePath(pathname)
  if (!filePath) {
    send(response, 404, "not found\n", "text/plain; charset=utf-8")
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      send(response, 404, "not found\n", "text/plain; charset=utf-8")
      return
    }

    const body = await readFile(filePath)
    send(
      response,
      200,
      body,
      MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream"
    )
  } catch {
    send(response, 404, "not found\n", "text/plain; charset=utf-8")
  }
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
) {
  if (request.method !== "GET") {
    send(response, 405, "method not allowed\n", "text/plain; charset=utf-8")
    return
  }

  const url = new URL(request.url ?? "/", "http://localhost")
  if (url.pathname === "/healthz") {
    send(response, 200, "ok\n", "text/plain; charset=utf-8")
    return
  }

  if (url.pathname === "/api/status") {
    sendJson(response, 200, await getStatus())
    return
  }

  await serveStatic(url.pathname, response)
}

export function main() {
  createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: String(error) })
    })
  }).listen(PORT, HOST, () => {
    console.log(`nazboard listening on http://${HOST}:${PORT}`)
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] === currentFile) {
  main()
}
