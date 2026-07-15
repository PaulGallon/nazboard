import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import {
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"

import type {
  CommandResult,
  DatasetProperty,
  DatasetStatus,
  DiskStatus,
  Issue,
  PoolStatus,
  SnapshotStatus,
  State,
  StatusPayload,
  VdevStatus,
} from "../shared/status.js"

const HOST = "0.0.0.0"
const COMMAND_TIMEOUT_MS = 5000
const COMMAND_CACHE_TTL_MS = 60_000
const COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024
export const FIXTURE_DIR_ENV = "NAZBOARD_FIXTURE_DIR"

function parsePort(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `PORT must be an integer between 1 and 65535; received ${value}`
    )
  }
  const port = Number(value)
  if (port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535; received ${value}`
    )
  }
  return port
}

const PORT = parsePort(process.env.PORT ?? "8080")

const OBSERVED_AT = Symbol("observedAt")
const commandCache = new Map<
  string,
  { observedAt: number; result: ObservedCommandResult }
>()
const pendingCommands = new Map<string, Promise<ObservedCommandResult>>()

type ObservedCommandResult = CommandResult & {
  [OBSERVED_AT]?: number
}

function withObservedAt(result: CommandResult, observedAt = Date.now()) {
  Object.defineProperty(result, OBSERVED_AT, {
    value: observedAt,
    enumerable: false,
  })
  return result as ObservedCommandResult
}

type PoolTopology = {
  pool_name: string
  vdevs: VdevStatus[]
}

const BASE_COMMANDS: Array<[string, string[]]> = [
  ["ZFS health summary", ["zpool", "status", "-x"]],
  [
    "zpool list",
    ["zpool", "list", "-H", "-p", "-o", "name,size,alloc,free,health"],
  ],
  ["zpool status", ["zpool", "status"]],
  [
    "zfs list",
    [
      "zfs",
      "list",
      "-H",
      "-p",
      "-o",
      "name,used,avail,refer,mountpoint,usedbysnapshots",
    ],
  ],
  [
    "zfs snapshots",
    [
      "zfs",
      "list",
      "-H",
      "-p",
      "-t",
      "snapshot",
      "-o",
      "name,used,refer,creation",
    ],
  ],
  [
    "zfs get all",
    [
      "zfs",
      "get",
      "-H",
      "-p",
      "-t",
      "filesystem,volume,snapshot",
      "-o",
      "name,property,value,source",
      "all",
    ],
  ],
]

const FIXTURE_FILES = new Map<string, string>([
  [["zpool", "status", "-x"].join("\0"), "zpool_status_x.txt"],
  [
    ["zpool", "list", "-H", "-p", "-o", "name,size,alloc,free,health"].join(
      "\0"
    ),
    "zpool_list.txt",
  ],
  [["zpool", "status"].join("\0"), "zpool_status.txt"],
  [
    [
      "zfs",
      "list",
      "-H",
      "-p",
      "-o",
      "name,used,avail,refer,mountpoint,usedbysnapshots",
    ].join("\0"),
    "zfs_list.txt",
  ],
  [
    [
      "zfs",
      "list",
      "-H",
      "-p",
      "-t",
      "snapshot",
      "-o",
      "name,used,refer,creation",
    ].join("\0"),
    "zfs_snapshots.txt",
  ],
  [
    [
      "zfs",
      "get",
      "-H",
      "-p",
      "-t",
      "filesystem,volume,snapshot",
      "-o",
      "name,property,value,source",
      "all",
    ].join("\0"),
    "zfs_get_all.txt",
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
const ZFS_SIZE_PATTERN = /^(\d+(?:\.\d+)?)([BKMGTPE])?$/i

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

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
}

function commandKey(command: string[]) {
  return command.join("\0")
}

function commandCacheKey(title: string, command: string[]) {
  return `${title}\0${commandKey(command)}`
}

function commandOk(result: CommandResult) {
  return result.returncode === 0 && result.error === null
}

function fixtureFilenameForCommand(command: string[]) {
  return FIXTURE_FILES.get(commandKey(command)) ?? null
}

export async function readFixture(
  title: string,
  command: string[],
  directory: string
): Promise<CommandResult> {
  const filename = fixtureFilenameForCommand(command)
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

function readCachedCommand(key: string) {
  const cached = commandCache.get(key)
  if (!cached) {
    return null
  }
  if (Date.now() - cached.observedAt > COMMAND_CACHE_TTL_MS) {
    commandCache.delete(key)
    return null
  }
  return cached.result
}

export async function runCommand(
  title: string,
  command: string[]
): Promise<CommandResult> {
  const fixtureDir = process.env[FIXTURE_DIR_ENV]
  if (fixtureDir) {
    return readFixture(title, command, fixtureDir)
  }

  const key = commandCacheKey(title, command)
  const cached = readCachedCommand(key)
  if (cached) {
    return cached
  }

  const pending = pendingCommands.get(key)
  if (pending) {
    return pending
  }

  const execution = new Promise<CommandResult>((resolveCommand) => {
    execFile(
      command[0],
      command.slice(1),
      {
        encoding: "utf8",
        env: { LC_ALL: "C", PATH: process.env.PATH },
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
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
    .then((result) => {
      const observedAt = Date.now()
      const observedResult = withObservedAt(result, observedAt)
      commandCache.set(key, { observedAt, result: observedResult })
      return observedResult
    })
    .finally(() => {
      pendingCommands.delete(key)
    })

  pendingCommands.set(key, execution)
  return execution
}

export function parseZfsSize(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-") {
    return null
  }

  const match = trimmed.match(ZFS_SIZE_PATTERN)
  if (!match) {
    return null
  }

  const parsed = Number.parseFloat(match[1])
  const multiplier = match[2]
    ? (SIZE_UNITS.get(match[2].toUpperCase()) ?? 1)
    : 1
  const bytes = parsed * multiplier
  return Number.isFinite(bytes) ? bytes : null
}

function usedPercent(used: number, available: number) {
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
  const health = results.find((result) => result.title === "ZFS health summary")
  if (!health || !commandOk(health)) {
    return { state: "error", message: "Unable to read ZFS health" }
  }
  if (results.some((result) => !commandOk(result))) {
    return { state: "error", message: "Unable to read complete ZFS status" }
  }

  const combined = `${health.stdout}\n${health.stderr}`.toLowerCase()
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
      const parts = line.split("\t")
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
        snapshot_used_bytes: 0,
        vdevs: [],
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
      const parts = line.split("\t")
      if (parts.length < 5 || parts[0].toUpperCase() === "NAME") {
        return null
      }

      const used = parseZfsSize(parts[1])
      const available = parseZfsSize(parts[2])
      const refer = parseZfsSize(parts[3])
      const snapshotUsed = parseZfsSize(parts[5] ?? "-") ?? 0
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
        snapshot_used_bytes: snapshotUsed,
        mountpoint: parts[4],
        used_percent: percent,
        state: classifyUsage(percent),
        properties: [],
        snapshots: [],
        children: [],
      }
      return dataset
    })
    .filter((dataset): dataset is DatasetStatus => dataset !== null)
}

export function parseZfsProperties(
  results: CommandResult[]
): Map<string, DatasetProperty[]> {
  const propertiesByDataset = new Map<string, DatasetProperty[]>()

  for (const result of results) {
    if (result.title !== "zfs get all" || !commandOk(result)) {
      continue
    }

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      const parts = line.split("\t")
      if (parts.length < 4 || parts[0].toUpperCase() === "NAME") {
        continue
      }

      const [datasetPath, property, value, source] = parts
      const datasetProperties = propertiesByDataset.get(datasetPath) ?? []
      datasetProperties.push({ property, value, source })
      propertiesByDataset.set(datasetPath, datasetProperties)
    }
  }

  return propertiesByDataset
}

export function parseSnapshots(results: CommandResult[]): SnapshotStatus[] {
  const snapshotList = results.find(
    (result) => result.title === "zfs snapshots"
  )
  if (!snapshotList || !commandOk(snapshotList)) {
    return []
  }

  return snapshotList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t")
      if (parts.length < 4 || parts[0].toUpperCase() === "NAME") {
        return null
      }

      const separator = parts[0].lastIndexOf("@")
      const used = parseZfsSize(parts[1])
      if (separator < 1 || used === null) {
        return null
      }

      const creationSeconds = /^\d+$/.test(parts[3])
        ? Number.parseInt(parts[3], 10)
        : Number.NaN
      const creationDate = new Date(creationSeconds * 1000)
      const snapshot: SnapshotStatus = {
        name: parts[0].slice(separator + 1),
        path: parts[0],
        dataset_path: parts[0].slice(0, separator),
        used_bytes: used,
        refer_bytes: parseZfsSize(parts[2]),
        created_at: Number.isNaN(creationDate.valueOf())
          ? null
          : creationDate.toISOString(),
        properties: [],
      }
      return snapshot
    })
    .filter((snapshot): snapshot is SnapshotStatus => snapshot !== null)
}

type VdevNode = DiskStatus & {
  indent: number
  class_name: string
  children: VdevNode[]
}

const VDEV_CLASSES = new Map<string, string>([
  ["logs", "log"],
  ["log", "log"],
  ["cache", "cache"],
  ["spares", "spare"],
  ["spare", "spare"],
  ["special", "special"],
  ["dedup", "dedup"],
])

function vdevType(name: string, className: string) {
  const namedType = name.match(/^(mirror|raidz\d?|draid\d?|replacing|spare)/i)
  return (
    namedType?.[1].toLowerCase() ?? (className === "data" ? "disk" : className)
  )
}

function leafDisks(node: VdevNode): DiskStatus[] {
  if (node.children.length === 0) {
    return [
      {
        name: node.name,
        state: node.state,
        read_errors: node.read_errors,
        write_errors: node.write_errors,
        checksum_errors: node.checksum_errors,
      },
    ]
  }
  return node.children.flatMap(leafDisks)
}

export function parseVdevs(results: CommandResult[]): PoolTopology[] {
  const status = results.find((result) => result.title === "zpool status")
  if (!status || !commandOk(status)) {
    return []
  }

  const poolMatches = [...status.stdout.matchAll(/^\s*pool:\s+(\S+)\s*$/gm)]

  return poolMatches.map((poolMatch, poolIndex) => {
    const poolName = poolMatch[1]
    const start = poolMatch.index ?? 0
    const end = poolMatches[poolIndex + 1]?.index ?? status.stdout.length
    const section = status.stdout.slice(start, end)
    const configStart = section.indexOf("config:")
    const configEnd = section.indexOf("errors:", configStart)
    const config =
      configStart >= 0
        ? section.slice(
            configStart,
            configEnd >= 0 ? configEnd : section.length
          )
        : ""

    let className = "data"
    let root: VdevNode | null = null
    const stack: VdevNode[] = []

    for (const line of config.split(/\r?\n/)) {
      const trimmed = line.trim()
      const nextClass = VDEV_CLASSES.get(trimmed.toLowerCase())
      if (nextClass) {
        className = nextClass
        stack.splice(root ? 1 : 0)
        continue
      }

      const match = line.match(
        /^(\s*)(\S+)\s+(\S+)(?:\s+(\d+|-)\s+(\d+|-)\s+(\d+|-))?(?:\s+.*)?$/
      )
      if (!match || match[2].toUpperCase() === "NAME") {
        continue
      }

      const node: VdevNode = {
        name: match[2],
        state: match[3],
        read_errors: Number.parseInt(match[4] ?? "", 10) || 0,
        write_errors: Number.parseInt(match[5] ?? "", 10) || 0,
        checksum_errors: Number.parseInt(match[6] ?? "", 10) || 0,
        indent: match[1].replaceAll("\t", "        ").length,
        class_name: className,
        children: [],
      }

      if (node.name === poolName) {
        root = node
        stack.splice(0, stack.length, node)
        continue
      }

      while (
        stack.length > 0 &&
        stack[stack.length - 1].indent >= node.indent
      ) {
        stack.pop()
      }
      const parent = stack.at(-1)
      if (parent) {
        parent.children.push(node)
      } else if (root) {
        root.children.push(node)
      }
      stack.push(node)
    }

    return {
      pool_name: poolName,
      vdevs: (root?.children ?? []).map((node) => ({
        name: node.name,
        state: node.state,
        read_errors: node.read_errors,
        write_errors: node.write_errors,
        checksum_errors: node.checksum_errors,
        type: vdevType(node.name, node.class_name),
        class_name: node.class_name,
        disks: leafDisks(node),
      })),
    }
  })
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

function attachPoolDetails(
  pools: PoolStatus[],
  snapshots: SnapshotStatus[],
  topologies: PoolTopology[],
  propertiesByDataset: Map<string, DatasetProperty[]> = new Map()
) {
  const snapshotsByDataset = new Map<string, SnapshotStatus[]>()
  for (const snapshot of snapshots) {
    const datasetSnapshots = snapshotsByDataset.get(snapshot.dataset_path) ?? []
    datasetSnapshots.push(snapshot)
    snapshotsByDataset.set(snapshot.dataset_path, datasetSnapshots)
  }

  const attachSnapshots = (dataset: DatasetStatus): DatasetStatus => ({
    ...dataset,
    properties: propertiesByDataset.get(dataset.path) ?? [],
    snapshots: (snapshotsByDataset.get(dataset.path) ?? [])
      .map((snapshot) => ({
        ...snapshot,
        properties: propertiesByDataset.get(snapshot.path) ?? [],
      }))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    children: dataset.children.map(attachSnapshots),
  })
  const topologyByPool = new Map(
    topologies.map((topology) => [topology.pool_name, topology.vdevs])
  )

  return pools.map((pool) => {
    const datasets = pool.datasets.map(attachSnapshots)
    const snapshotUsedBytes = datasets.reduce((poolTotal, dataset) => {
      const visit = (item: DatasetStatus): number =>
        item.snapshot_used_bytes +
        item.children.reduce((total, child) => total + visit(child), 0)
      return poolTotal + visit(dataset)
    }, 0)

    return {
      ...pool,
      datasets,
      snapshot_used_bytes: snapshotUsedBytes,
      vdevs: topologyByPool.get(pool.name) ?? [],
    }
  })
}

function collectIssues(
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
        severity: pool.health.toUpperCase() === "DEGRADED" ? "warn" : "error",
        scope: "pool",
        name: pool.name,
        message: `Pool health is ${pool.health}`,
      })
    }
    for (const vdev of pool.vdevs) {
      if (!["ONLINE", "AVAIL"].includes(vdev.state.toUpperCase())) {
        issues.push({
          severity: vdev.state.toUpperCase() === "DEGRADED" ? "warn" : "error",
          scope: "vdev",
          name: `${pool.name}/${vdev.name}`,
          message: `${vdev.type} vdev is ${vdev.state}`,
        })
      }
      for (const disk of vdev.disks) {
        const errorCount =
          disk.read_errors + disk.write_errors + disk.checksum_errors
        if (
          !["ONLINE", "AVAIL"].includes(disk.state.toUpperCase()) ||
          errorCount > 0
        ) {
          issues.push({
            severity:
              disk.state.toUpperCase() === "DEGRADED" && errorCount === 0
                ? "warn"
                : "error",
            scope: "disk",
            name: disk.name,
            message:
              errorCount > 0
                ? `${errorCount} read, write, or checksum errors reported`
                : `Disk is ${disk.state}`,
          })
        }
      }
    }
    for (const dataset of pool.datasets) {
      visitDataset(dataset)
    }
  }

  return issues
}

export async function getStatus(): Promise<StatusPayload> {
  const baseCommands = await Promise.all(
    BASE_COMMANDS.map(([title, command]) => runCommand(title, command))
  )
  const datasets = parseDatasets(baseCommands)
  const commands = baseCommands
  const overall = classifyOverall(commands)
  const pools = attachPoolDetails(
    attachDatasetsToPools(parsePools(commands), datasets),
    parseSnapshots(commands),
    parseVdevs(commands),
    parseZfsProperties(commands)
  )
  const generatedAt = Math.min(
    ...baseCommands.map(
      (command) => (command as ObservedCommandResult)[OBSERVED_AT] ?? Date.now()
    )
  )

  return {
    generated_at: new Date(generatedAt).toISOString(),
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
  contentType: string,
  headers: Record<string, string> = {}
) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
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
  const requestedPath =
    pathname === "/"
      ? "index.html"
      : decodeURIComponent(pathname).replace(/^\/+/, "")
  const candidate = normalize(join(root, requestedPath))
  const relativePath = relative(root, candidate)
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null
  }
  return candidate
}

async function serveStatic(pathname: string, response: ServerResponse) {
  let filePath: string | null
  try {
    filePath = staticFilePath(pathname)
  } catch (error) {
    if (error instanceof URIError) {
      send(response, 400, "bad request\n", "text/plain; charset=utf-8")
      return
    }
    throw error
  }
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
      MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      {
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      }
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
    send(response, 405, "method not allowed\n", "text/plain; charset=utf-8", {
      Allow: "GET",
    })
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

function createAppServer() {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      console.error("Request failed", error)
      sendJson(response, 500, { error: "Internal server error" })
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 100
  return server
}

function main() {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`nazboard listening on http://${HOST}:${PORT}`)
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] === currentFile) {
  main()
}
