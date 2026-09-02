import type {
  CommandResult,
  DiskHealthStatus,
  MetricState,
  SmartDiskStatus,
  SmartMetric,
} from "../shared/status.js"

type JsonObject = Record<string, unknown>

type SmartDevice = {
  name: string
  type: string
  protocol: string
}

type BlockIdentity = {
  path: string
  manufacturer: string | null
  model: string | null
  serial: string | null
  wwn: string | null
  capacityBytes: number | null
}

type CommandRunner = (
  title: string,
  command: string[]
) => Promise<CommandResult>

const SMART_SCAN_COMMAND = ["smartctl", "--scan-open", "-j"]
export const BLOCK_DEVICE_COMMAND = [
  "lsblk",
  "--json",
  "--bytes",
  "--nodeps",
  "--output",
  "NAME,PATH,VENDOR,MODEL,WWN,SERIAL,TYPE,SIZE",
]

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numeric(value: unknown): number | null {
  const direct = number(value)
  if (direct !== null) {
    return direct
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseJson(result: CommandResult): JsonObject | null {
  if (result.error || !result.stdout.trim()) {
    return null
  }
  try {
    return object(JSON.parse(result.stdout))
  } catch {
    return null
  }
}

function smartctlMessage(document: JsonObject) {
  const messages = object(document.smartctl)?.messages
  if (!Array.isArray(messages)) {
    return null
  }
  for (const value of messages) {
    const message = object(value)
    const text = string(message?.string)
    if (text) {
      return text
    }
  }
  return null
}

function parseDevices(result: CommandResult): SmartDevice[] {
  const document = parseJson(result)
  const devices = document?.devices
  if (!Array.isArray(devices)) {
    return []
  }

  return devices.flatMap((value) => {
    const device = object(value)
    const name = string(device?.name)
    const type = string(device?.type)
    if (!name || !type || !name.startsWith("/dev/")) {
      return []
    }
    return [
      {
        name,
        type,
        protocol: string(device?.protocol) ?? "Unknown",
      },
    ]
  })
}

export function parseBlockIdentities(result: CommandResult): BlockIdentity[] {
  const devices = parseJson(result)?.blockdevices
  if (!Array.isArray(devices)) {
    return []
  }

  return devices.flatMap((value) => {
    const device = object(value)
    const path = string(device?.path)
    if (!path || string(device?.type)?.toLowerCase() !== "disk") {
      return []
    }
    return [
      {
        path,
        manufacturer: string(device?.vendor),
        model: string(device?.model),
        serial: string(device?.serial),
        wwn: string(device?.wwn),
        capacityBytes: numeric(device?.size),
      },
    ]
  })
}

function identityForDevice(device: SmartDevice, identities: BlockIdentity[]) {
  return (
    identities.find((identity) => identity.path === device.name) ??
    identities.find(
      (identity) =>
        device.type === "nvme" &&
        identity.path.startsWith(`${device.name}n`) &&
        /^\d+$/.test(identity.path.slice(`${device.name}n`.length))
    ) ??
    null
  )
}

function manufacturerFromModel(model: string | null) {
  return model?.split(/[\s-]+/)[0] ?? null
}

function smartWwn(document: JsonObject) {
  const wwn = object(document.wwn)
  const naa = number(wwn?.naa)
  const oui = number(wwn?.oui)
  const id = number(wwn?.id)
  if (naa !== null && oui !== null && id !== null) {
    return `0x${naa.toString(16)}${oui.toString(16).padStart(6, "0")}${id.toString(16).padStart(9, "0")}`
  }
  return string(document.logical_unit_id)
}

function smartResultSupportsAta(result: CommandResult) {
  const document = parseJson(result)
  if (!document || string(object(document.device)?.protocol) !== "ATA") {
    return false
  }
  const passed = object(document.smart_status)?.passed
  const support = object(document.smart_support)?.available
  const attributes = object(document.ata_smart_attributes)?.table
  return (
    typeof passed === "boolean" || support === true || Array.isArray(attributes)
  )
}

function shouldTrySat(device: SmartDevice, result: CommandResult) {
  if (device.type !== "scsi") {
    return false
  }
  const document = parseJson(result)
  return object(document?.smart_support)?.available === false
}

function smartQuery(device: SmartDevice) {
  return ["ata", "sat", "scsi", "nvme"].includes(device.type)
    ? ["smartctl", "-a", "-j", device.name]
    : ["smartctl", "-a", "-j", "-d", device.type, device.name]
}

function rawAttributeValue(attribute: JsonObject) {
  const raw = object(attribute.raw)
  return number(raw?.value)
}

function ataAttribute(document: JsonObject, ids: number[]) {
  const attributes = object(document.ata_smart_attributes)?.table
  if (!Array.isArray(attributes)) {
    return null
  }
  for (const value of attributes) {
    const attribute = object(value)
    if (attribute && ids.includes(number(attribute.id) ?? -1)) {
      return attribute
    }
  }
  return null
}

function failedAttribute(attribute: JsonObject | null) {
  const failed = string(attribute?.when_failed)?.toLowerCase()
  return Boolean(failed && failed !== "-")
}

function countMetric(
  key: string,
  label: string,
  count: number,
  goodDetail: string,
  issueDetail: string,
  failed = false
): SmartMetric {
  return {
    key,
    label,
    value: count.toLocaleString("en-GB"),
    state: failed ? "failed" : count === 0 ? "healthy" : "warning",
    detail: count === 0 ? goodDetail : issueDetail,
  }
}

function temperatureMetric(
  temperature: number | null,
  document: JsonObject
): SmartMetric | null {
  const temperatureData = object(document.temperature)
  if (temperature === null && !temperatureData) {
    return null
  }
  if (temperature === null) {
    return {
      key: "temperature",
      label: "Temperature",
      value: "Unknown",
      state: "warning",
      detail: "The drive did not report a live temperature.",
    }
  }

  const limit = number(temperatureData?.op_limit_max)
  const nvmeWarning = number(
    object(document.nvme_smart_health_information_log)?.critical_warning
  )
  const temperatureWarning = Boolean((nvmeWarning ?? 0) & 0x02)
  const criticalAt = limit ?? 60
  const state: MetricState =
    temperatureWarning || temperature >= criticalAt - 10 ? "warning" : "healthy"

  return {
    key: "temperature",
    label: "Temperature",
    value: `${temperature}°C`,
    state,
    detail: limit
      ? `Drive operating limit: ${limit}°C.`
      : "Needs attention from 50°C when the drive supplies no operating limit.",
  }
}

function overallMetric(document: JsonObject): SmartMetric {
  const passed = object(document.smart_status)?.passed
  const supportAvailable = object(document.smart_support)?.available
  const state: MetricState =
    passed === true ? "healthy" : passed === false ? "failed" : "warning"
  return {
    key: "smart-status",
    label: "SMART assessment",
    value:
      passed === true
        ? "Passed"
        : passed === false
          ? "Failed"
          : supportAvailable === false
            ? "Unavailable"
            : "Unknown",
    state,
    detail:
      passed === true
        ? "The drive's overall SMART self-assessment passed."
        : passed === false
          ? "The drive reports a failed SMART self-assessment."
          : supportAvailable === false
            ? "This device reports that SMART monitoring is unavailable."
            : "The drive did not provide an overall SMART assessment.",
  }
}

function ataMetrics(document: JsonObject): SmartMetric[] {
  const definitions = [
    {
      key: "reallocated",
      label: "Reallocated sectors",
      ids: [5],
      good: "No sectors have been remapped.",
      issue:
        "The drive has remapped unreliable sectors; monitor for increases.",
    },
    {
      key: "pending",
      label: "Pending sectors",
      ids: [197],
      good: "No unstable sectors are awaiting remapping.",
      issue: "Unstable sectors are waiting to be re-read or remapped.",
    },
    {
      key: "uncorrectable",
      label: "Offline uncorrectable",
      ids: [198],
      good: "Offline scans found no uncorrectable sectors.",
      issue: "Offline scans found data that could not be corrected.",
    },
    {
      key: "interface-errors",
      label: "Interface errors",
      ids: [199],
      good: "No SATA link CRC errors were recorded.",
      issue:
        "SATA link errors were recorded; inspect cabling if the count rises.",
    },
  ]

  return definitions.flatMap((definition) => {
    const attribute = ataAttribute(document, definition.ids)
    const value = attribute ? rawAttributeValue(attribute) : null
    return value === null
      ? []
      : [
          countMetric(
            definition.key,
            definition.label,
            value,
            definition.good,
            definition.issue,
            failedAttribute(attribute)
          ),
        ]
  })
}

function nvmeMetrics(document: JsonObject): SmartMetric[] {
  const log = object(document.nvme_smart_health_information_log)
  if (!log) {
    return []
  }

  const metrics: SmartMetric[] = []
  const used = number(log.percentage_used)
  if (used !== null) {
    const remaining = Math.max(0, 100 - used)
    metrics.push({
      key: "endurance",
      label: "Endurance remaining",
      value: `${remaining}%`,
      state: remaining <= 20 ? "warning" : "healthy",
      detail: `${used}% of the drive's rated endurance has been consumed.`,
    })
  }

  const spare = number(log.available_spare)
  const threshold = number(log.available_spare_threshold)
  if (spare !== null && threshold !== null) {
    metrics.push({
      key: "available-spare",
      label: "Available spare",
      value: `${spare}%`,
      state: spare <= threshold + 5 ? "warning" : "healthy",
      detail: `The drive's critical spare threshold is ${threshold}%.`,
    })
  }

  const mediaErrors = number(log.media_errors)
  if (mediaErrors !== null) {
    metrics.push(
      countMetric(
        "media-errors",
        "Media errors",
        mediaErrors,
        "No unrecovered data-integrity errors were recorded.",
        "The controller recorded unrecovered data-integrity errors."
      )
    )
  }
  return metrics
}

function worstState(states: MetricState[]): MetricState {
  return states.includes("failed")
    ? "failed"
    : states.includes("warning")
      ? "warning"
      : "healthy"
}

const DISK_STATE_PRIORITY: Record<MetricState, number> = {
  failed: 0,
  warning: 1,
  healthy: 2,
}

export function diskAttentionSummary(disk: SmartDiskStatus) {
  const metric =
    disk.metrics.find((candidate) => candidate.state === "failed") ??
    disk.metrics.find((candidate) => candidate.state === "warning")
  if (!metric) {
    return disk.status
  }
  if (metric.key === "temperature") {
    return disk.temperature_celsius === null
      ? "temperature unavailable"
      : `temperature elevated (${metric.value})`
  }
  if (metric.key === "smart-status") {
    return `SMART assessment ${metric.value.toLowerCase()}`
  }
  return `${metric.label.toLowerCase()} ${metric.value}`
}

export function parseSmartDisk(
  device: SmartDevice,
  result: CommandResult,
  identity: BlockIdentity | null = null
): SmartDiskStatus {
  const document = parseJson(result)
  if (!document) {
    return {
      device: identity?.path ?? device.name,
      protocol: device.protocol,
      manufacturer: identity?.manufacturer ?? null,
      model: identity?.model ?? "Unknown disk",
      serial: identity?.serial ?? null,
      wwn: identity?.wwn ?? null,
      capacity_bytes: identity?.capacityBytes ?? null,
      temperature_celsius: null,
      pool_name: null,
      vdev_name: null,
      state: "warning",
      status: result.error ?? "SMART data could not be parsed.",
      metrics: [],
    }
  }

  const reportedTemperature = number(object(document.temperature)?.current)
  const temperature =
    reportedTemperature !== null && reportedTemperature > 0
      ? reportedTemperature
      : null
  const temperatureHealth = temperatureMetric(temperature, document)
  const metrics = [
    overallMetric(document),
    ...(temperatureHealth ? [temperatureHealth] : []),
    ...ataMetrics(document),
    ...nvmeMetrics(document),
  ]
  const state = worstState(metrics.map((metric) => metric.state))
  const scsiModel = [string(document.vendor), string(document.product)]
    .filter((value): value is string => value !== null)
    .join(" ")
  const model =
    identity?.model ??
    string(document.model_name) ??
    string(document.scsi_model_name) ??
    (scsiModel || `Disk ${device.name.slice("/dev/".length)}`)
  const smartManufacturer = string(document.vendor)
  const blockManufacturer = identity?.manufacturer
  const manufacturer =
    blockManufacturer &&
    !["ata", "nvme"].includes(blockManufacturer.toLowerCase())
      ? blockManufacturer
      : (smartManufacturer ?? manufacturerFromModel(model))
  return {
    device: identity?.path ?? device.name,
    protocol: string(object(document.device)?.protocol) ?? device.protocol,
    manufacturer,
    model,
    serial: string(document.serial_number) ?? identity?.serial ?? null,
    wwn: identity?.wwn ?? smartWwn(document) ?? null,
    capacity_bytes:
      number(object(document.user_capacity)?.bytes) ??
      identity?.capacityBytes ??
      null,
    temperature_celsius: temperature,
    pool_name: null,
    vdev_name: null,
    state,
    status:
      smartctlMessage(document) ??
      (object(document.smart_support)?.available === false
        ? "SMART monitoring is unavailable for this device."
        : state === "healthy"
          ? "All reported health indicators are good."
          : state === "warning"
            ? "One or more indicators need attention."
            : "One or more indicators have failed."),
    metrics,
  }
}

export function smartEnabled(environment = process.env) {
  return !["0", "false", "no", "off"].includes(
    (environment.NAZBOARD_SMART_ENABLED ?? "true").trim().toLowerCase()
  )
}

export async function getDiskHealth(
  runCommand: CommandRunner
): Promise<DiskHealthStatus> {
  if (!smartEnabled()) {
    return {
      enabled: false,
      state: "healthy",
      message: "SMART disk health monitoring is disabled.",
      disks: [],
    }
  }

  const [scan, blockDevices] = await Promise.all([
    runCommand("SMART device scan", SMART_SCAN_COMMAND),
    runCommand("Block device identity", BLOCK_DEVICE_COMMAND),
  ])
  const devices = parseDevices(scan)
  const identities = parseBlockIdentities(blockDevices)
  if (!parseJson(scan)) {
    return {
      enabled: true,
      state: "warning",
      message:
        scan.error ??
        "Physical disk discovery failed. Check smartctl availability and device permissions.",
      disks: [],
    }
  }

  const disks = (
    await Promise.all(
      devices.map(async (device) => {
        let result = await runCommand(
          `SMART ${device.name}`,
          smartQuery(device)
        )
        if (shouldTrySat(device, result)) {
          const satResult = await runCommand(`SMART ${device.name} (SAT)`, [
            "smartctl",
            "-a",
            "-j",
            "-d",
            "sat",
            device.name,
          ])
          if (smartResultSupportsAta(satResult)) {
            result = satResult
          }
        }
        return parseSmartDisk(
          device,
          result,
          identityForDevice(device, identities)
        )
      })
    )
  ).sort(
    (left, right) =>
      DISK_STATE_PRIORITY[left.state] - DISK_STATE_PRIORITY[right.state]
  )
  const state =
    disks.length === 0 ? "warning" : worstState(disks.map((disk) => disk.state))
  const attention = disks.filter((disk) => disk.state !== "healthy")
  return {
    enabled: true,
    state,
    message:
      disks.length === 0
        ? "No SMART-capable physical disks were discovered."
        : state === "healthy"
          ? `All ${disks.length} physical disks report good health.`
          : `${attention.length} disk${attention.length === 1 ? " needs" : "s need"} attention — ${attention
              .slice(0, 2)
              .map((disk) => `${disk.device}: ${diskAttentionSummary(disk)}`)
              .join(
                "; "
              )}${attention.length > 2 ? `; +${attention.length - 2} more` : ""}.`,
    disks,
  }
}
