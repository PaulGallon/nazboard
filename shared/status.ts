export type State = "ok" | "warn" | "error"

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
  scope: "overall" | "pool" | "vdev" | "disk" | "dataset" | "command"
  name: string
  message: string
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
