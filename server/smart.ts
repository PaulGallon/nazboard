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

type CommandRunner = (
  title: string,
  command: string[]
) => Promise<CommandResult>

const SMART_SCAN_COMMAND = ["smartctl", "--scan-open", "-j"]

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
  severity: "bad" | "critical",
  goodDetail: string,
  issueDetail: string,
  failed = false
): SmartMetric {
  return {
    key,
    label,
    value: count.toLocaleString("en-GB"),
    state: count === 0 ? "good" : failed ? "critical" : severity,
    detail: count === 0 ? goodDetail : issueDetail,
  }
}

function temperatureMetric(
  temperature: number | null,
  document: JsonObject
): SmartMetric {
  if (temperature === null) {
    return {
      key: "temperature",
      label: "Temperature",
      value: "Unknown",
      state: "bad",
      detail: "The drive did not report a live temperature.",
    }
  }

  const temperatureData = object(document.temperature)
  const limit = number(temperatureData?.op_limit_max)
  const nvmeWarning = number(
    object(document.nvme_smart_health_information_log)?.critical_warning
  )
  const temperatureWarning = Boolean((nvmeWarning ?? 0) & 0x02)
  const criticalAt = limit ?? 60
  const state: MetricState =
    temperatureWarning || temperature >= criticalAt
      ? "critical"
      : temperature >= criticalAt - 10
        ? "bad"
        : "good"

  return {
    key: "temperature",
    label: "Temperature",
    value: `${temperature}°C`,
    state,
    detail: limit
      ? `Drive operating limit: ${limit}°C.`
      : "Warns from 50°C and becomes critical at 60°C when the drive supplies no operating limit.",
  }
}

function overallMetric(document: JsonObject): SmartMetric {
  const passed = object(document.smart_status)?.passed
  const supportAvailable = object(document.smart_support)?.available
  const state: MetricState =
    passed === true
      ? "good"
      : passed === false
        ? "critical"
        : supportAvailable === false
          ? "bad"
          : "critical"
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
      severity: "bad" as const,
      good: "No sectors have been remapped.",
      issue:
        "The drive has remapped unreliable sectors; monitor for increases.",
    },
    {
      key: "pending",
      label: "Pending sectors",
      ids: [197],
      severity: "critical" as const,
      good: "No unstable sectors are awaiting remapping.",
      issue: "Unstable sectors are waiting to be re-read or remapped.",
    },
    {
      key: "uncorrectable",
      label: "Offline uncorrectable",
      ids: [198],
      severity: "critical" as const,
      good: "Offline scans found no uncorrectable sectors.",
      issue: "Offline scans found data that could not be corrected.",
    },
    {
      key: "interface-errors",
      label: "Interface errors",
      ids: [199],
      severity: "bad" as const,
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
            definition.severity,
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
      state: remaining <= 10 ? "critical" : remaining <= 20 ? "bad" : "good",
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
      state:
        spare <= threshold
          ? "critical"
          : spare <= threshold + 5
            ? "bad"
            : "good",
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
        "critical",
        "No unrecovered data-integrity errors were recorded.",
        "The controller recorded unrecovered data-integrity errors."
      )
    )
  }
  return metrics
}

function worstState(states: MetricState[]): MetricState {
  return states.includes("critical")
    ? "critical"
    : states.includes("bad")
      ? "bad"
      : "good"
}

export function parseSmartDisk(
  device: SmartDevice,
  result: CommandResult
): SmartDiskStatus {
  const document = parseJson(result)
  if (!document) {
    return {
      device: device.name,
      protocol: device.protocol,
      model: "Unknown disk",
      serial: null,
      capacity_bytes: null,
      temperature_celsius: null,
      state: "critical",
      status: result.error ?? "SMART data could not be parsed.",
      metrics: [],
    }
  }

  const reportedTemperature = number(object(document.temperature)?.current)
  const temperature =
    reportedTemperature !== null && reportedTemperature > 0
      ? reportedTemperature
      : null
  const metrics = [
    overallMetric(document),
    temperatureMetric(temperature, document),
    ...ataMetrics(document),
    ...nvmeMetrics(document),
  ]
  const state = worstState(metrics.map((metric) => metric.state))
  const scsiModel = [string(document.vendor), string(document.product)]
    .filter((value): value is string => value !== null)
    .join(" ")
  return {
    device: device.name,
    protocol: string(object(document.device)?.protocol) ?? device.protocol,
    model:
      string(document.model_name) ??
      string(document.scsi_model_name) ??
      (scsiModel || `Disk ${device.name.slice("/dev/".length)}`),
    serial: string(document.serial_number),
    capacity_bytes: number(object(document.user_capacity)?.bytes),
    temperature_celsius: temperature,
    state,
    status:
      smartctlMessage(document) ??
      (object(document.smart_support)?.available === false
        ? "SMART monitoring is unavailable for this device."
        : state === "good"
          ? "All reported health indicators are good."
          : state === "bad"
            ? "One or more indicators need attention."
            : "One or more indicators are critical."),
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
      state: "good",
      message: "SMART disk health monitoring is disabled.",
      disks: [],
    }
  }

  const scan = await runCommand("SMART device scan", SMART_SCAN_COMMAND)
  const devices = parseDevices(scan)
  if (!parseJson(scan)) {
    return {
      enabled: true,
      state: "critical",
      message:
        scan.error ??
        "Physical disk discovery failed. Check smartctl availability and device permissions.",
      disks: [],
    }
  }

  const disks = await Promise.all(
    devices.map(async (device) => {
      const result = await runCommand(`SMART ${device.name}`, [
        "smartctl",
        "-a",
        "-j",
        "-d",
        device.type,
        device.name,
      ])
      return parseSmartDisk(device, result)
    })
  )
  const state =
    disks.length === 0 ? "bad" : worstState(disks.map((disk) => disk.state))
  return {
    enabled: true,
    state,
    message:
      disks.length === 0
        ? "No SMART-capable physical disks were discovered."
        : state === "good"
          ? `All ${disks.length} physical disks report good health.`
          : `${disks.filter((disk) => disk.state !== "good").length} of ${disks.length} physical disks need attention.`,
    disks,
  }
}
