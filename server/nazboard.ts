import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, mkdir, rename, stat, writeFile } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const HOST = "0.0.0.0"
export const PORT = Number.parseInt(process.env.PORT ?? "8080", 10)
export const COMMAND_TIMEOUT_MS = 5000
export const COMMAND_CACHE_TTL_MS = 60_000
export const CACHE_DIR_ENV = "NAZBOARD_CACHE_DIR"
export const FIXTURE_DIR_ENV = "NAZBOARD_FIXTURE_DIR"

const OBSERVED_AT = Symbol("observedAt")

type State = "ok" | "warn" | "error"

export type CommandResult = {
  title: string
  command: string[]
  returncode: number | null
  stdout: string
  stderr: string
  error: string | null
}

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

export type Issue = {
  severity: State
  scope: "overall" | "pool" | "vdev" | "disk" | "dataset" | "command"
  name: string
  message: string
}

export type DatasetStatus = {
  name: string
  path: string
  used_bytes: number
  available_bytes: number
  refer_bytes: number | null
  snapshot_used_bytes: number
  mountpoint: string
  used_percent: number
  state: State
  properties: DatasetProperty[]
  snapshots: SnapshotStatus[]
  children: DatasetStatus[]
}

export type DatasetProperty = {
  property: string
  value: string
  source: string
}

export type SnapshotStatus = {
  name: string
  path: string
  dataset_path: string
  used_bytes: number
  refer_bytes: number | null
  created_at: string | null
  properties: DatasetProperty[]
}

export type DiskStatus = {
  name: string
  state: string
  read_errors: number
  write_errors: number
  checksum_errors: number
}

export type VdevStatus = DiskStatus & {
  type: string
  class_name: string
  disks: DiskStatus[]
}

export type PoolTopology = {
  pool_name: string
  vdevs: VdevStatus[]
}

export type PoolStatus = {
  name: string
  size_bytes: number
  allocated_bytes: number
  free_bytes: number
  health: string
  used_percent: number
  snapshot_used_bytes: number
  vdevs: VdevStatus[]
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

const BASE_COMMANDS: Array<[string, string[]]> = [
  ["ZFS health summary", ["zpool", "status", "-x"]],
  ["zpool list", ["zpool", "list", "-H", "-o", "name,size,alloc,free,health"]],
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
    ["zpool", "list", "-H", "-o", "name,size,alloc,free,health"].join("\0"),
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

function cacheDirectory() {
  return process.env[CACHE_DIR_ENV] ?? join(tmpdir(), "nazboard-cache")
}

function cacheFilePath(command: string[]) {
  const digest = createHash("sha256")
    .update(commandKey(command))
    .digest("base64url")
  return join(cacheDirectory(), `${digest}.json`)
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

async function readCachedCommand(
  title: string,
  command: string[]
): Promise<CommandResult | null> {
  try {
    const cachePath = cacheFilePath(command)
    const [cacheStat, cacheContents] = await Promise.all([
      stat(cachePath),
      readFile(cachePath, "utf8"),
    ])
    if (Date.now() - cacheStat.mtimeMs > COMMAND_CACHE_TTL_MS) {
      return null
    }

    const cached = JSON.parse(cacheContents) as CommandResult
    if (
      cached.title === title &&
      Array.isArray(cached.command) &&
      commandKey(cached.command) === commandKey(command)
    ) {
      return withObservedAt(cached, cacheStat.mtimeMs)
    }
  } catch {
    return null
  }

  return null
}

async function writeCachedCommand(result: CommandResult) {
  try {
    const directory = cacheDirectory()
    await mkdir(directory, { recursive: true })
    const cachePath = cacheFilePath(result.command)
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(result), "utf8")
    await rename(temporaryPath, cachePath)
  } catch {
    // Cache failures should never make the read-only dashboard unavailable.
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

  const cached = await readCachedCommand(title, command)
  if (cached) {
    return cached
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
        const resolveAndCache = (result: CommandResult) => {
          const observedResult = withObservedAt(result)
          void writeCachedCommand(result).finally(() =>
            resolveCommand(observedResult)
          )
        }

        if (!error) {
          resolveAndCache({
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
          resolveAndCache({
            title,
            command,
            returncode: error.code,
            stdout,
            stderr,
            error: null,
          })
          return
        }

        resolveAndCache({
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
      const parts = line.split(/\s+/, 6)
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

      const parts = line.includes("\t")
        ? line.split("\t")
        : line.trim().split(/\s+/, 4)
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
      const parts = line.split(/\s+/, 4)
      if (parts.length < 4 || parts[0].toUpperCase() === "NAME") {
        return null
      }

      const separator = parts[0].lastIndexOf("@")
      const used = parseZfsSize(parts[1])
      if (separator < 1 || used === null) {
        return null
      }

      const creationSeconds = Number.parseInt(parts[3], 10)
      const snapshot: SnapshotStatus = {
        name: parts[0].slice(separator + 1),
        path: parts[0],
        dataset_path: parts[0].slice(0, separator),
        used_bytes: used,
        refer_bytes: parseZfsSize(parts[2]),
        created_at: Number.isNaN(creationSeconds)
          ? null
          : new Date(creationSeconds * 1000).toISOString(),
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
        /^(\s*)(\S+)\s+(\S+)\s+(\d+|-)\s+(\d+|-)\s+(\d+|-)(?:\s+.*)?$/
      )
      if (!match || match[2].toUpperCase() === "NAME") {
        continue
      }

      const node: VdevNode = {
        name: match[2],
        state: match[3],
        read_errors: Number.parseInt(match[4], 10) || 0,
        write_errors: Number.parseInt(match[5], 10) || 0,
        checksum_errors: Number.parseInt(match[6], 10) || 0,
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

export function attachPoolDetails(
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
        severity: pool.health.toUpperCase() === "DEGRADED" ? "warn" : "error",
        scope: "pool",
        name: pool.name,
        message: `Pool health is ${pool.health}`,
      })
    }
    for (const vdev of pool.vdevs) {
      if (vdev.state.toUpperCase() !== "ONLINE") {
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
        if (disk.state.toUpperCase() !== "ONLINE" || errorCount > 0) {
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
