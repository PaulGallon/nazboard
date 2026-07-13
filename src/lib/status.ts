export type State = "ok" | "warn" | "error"

export type Issue = {
  severity: State
  scope: "overall" | "pool" | "dataset" | "command"
  name: string
  message: string
}

export type CommandResult = {
  title: string
  command: string[]
  returncode: number | null
  stdout: string
  stderr: string
  error: string | null
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

export type Selection =
  | { kind: "overview" }
  | { kind: "pool"; id: string }
  | { kind: "dataset"; id: string }

export async function fetchStatus() {
  const response = await fetch("/api/status", { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Status request failed with ${response.status}`)
  }

  return (await response.json()) as StatusPayload
}

export function flattenDatasets(datasets: DatasetStatus[]): DatasetStatus[] {
  return datasets.flatMap((dataset) => [
    dataset,
    ...flattenDatasets(dataset.children),
  ])
}

export function findDataset(status: StatusPayload, path: string) {
  return status.pools
    .flatMap((pool) => flattenDatasets(pool.datasets))
    .find((dataset) => dataset.path === path)
}

export function formatBytes(bytes: number | null) {
  if (bytes === null) {
    return "-"
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function stateLabel(state: State) {
  if (state === "ok") {
    return "OK"
  }
  if (state === "warn") {
    return "Warn"
  }
  return "Error"
}
