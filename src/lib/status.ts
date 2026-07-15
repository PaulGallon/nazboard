import type {
  DatasetStatus,
  State,
  StatusPayload,
} from "../../shared/status.js"

export type {
  CommandResult,
  DatasetProperty,
  DatasetStatus,
  DiskStatus,
  Issue,
  PoolStatus,
  SnapshotStatus,
  State,
  StatusPayload,
} from "../../shared/status.js"

export type Selection =
  | { kind: "overview" }
  | { kind: "raw" }
  | { kind: "pool"; id: string }
  | { kind: "dataset"; id: string }

const BYTE_VALUE_PROPERTIES = new Set([
  "available",
  "logicalreferenced",
  "logicalused",
  "quota",
  "recordsize",
  "referenced",
  "refquota",
  "refreservation",
  "reservation",
  "special_small_blocks",
  "used",
  "usedbychildren",
  "usedbydataset",
  "usedbyrefreservation",
  "usedbysnapshots",
  "volblocksize",
  "volsize",
  "written",
])

export async function fetchStatus(signal?: AbortSignal) {
  const response = await fetch("/api/status", { cache: "no-store", signal })
  if (!response.ok) {
    throw new Error(`Status request failed with ${response.status}`)
  }

  return (await response.json()) as StatusPayload
}

export function selectionFromSearch(search: string): Selection {
  const parameters = new URLSearchParams(search)
  const dataset = parameters.get("dataset")
  if (dataset) {
    return { kind: "dataset", id: dataset }
  }

  const pool = parameters.get("pool")
  if (pool) {
    return { kind: "pool", id: pool }
  }

  return parameters.get("view") === "raw"
    ? { kind: "raw" }
    : { kind: "overview" }
}

export function searchForSelection(selection: Selection) {
  const parameters = new URLSearchParams()
  if (selection.kind === "dataset") {
    parameters.set("dataset", selection.id)
  } else if (selection.kind === "pool") {
    parameters.set("pool", selection.id)
  } else if (selection.kind === "raw") {
    parameters.set("view", "raw")
  }

  const search = parameters.toString()
  return search ? `?${search}` : ""
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

export function formatPropertyValue(value: string, propertyName: string) {
  if (value === "" || value === "-") {
    return "-"
  }

  if (propertyName === "sharenfs") {
    return value.replaceAll(",", ",\n")
  }

  const isByteValue =
    BYTE_VALUE_PROPERTIES.has(propertyName) ||
    propertyName.startsWith("written@")
  if (!isByteValue || !/^\d+$/.test(value)) {
    return value
  }

  const bytes = Number(value)
  return Number.isFinite(bytes) ? formatBytes(bytes) : value
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
