import {
  AlertTriangleIcon,
  ArrowDownIcon,
  CheckCircle2Icon,
  ShieldXIcon,
} from "lucide-react"

import { PanelHelp } from "@/components/panel-help"
import { Badge } from "@/components/ui/badge"
import {
  formatBytes,
  type DiskHealthStatus,
  type MetricState,
  type SmartDiskStatus,
  type SmartMetric,
} from "@/lib/status"
import { cn } from "@/lib/utils"

const STATE_LABELS: Record<MetricState, string> = {
  healthy: "Healthy",
  warning: "Warning",
  failed: "Failed",
}

const STATE_PRIORITY: Record<MetricState, number> = {
  failed: 0,
  warning: 1,
  healthy: 2,
}

const ATTENTION_STYLES: Record<MetricState, string> = {
  healthy: "border-border bg-background",
  warning:
    "border-amber-500/45 bg-amber-500/6 dark:border-amber-400/35 dark:bg-amber-400/6",
  failed:
    "border-destructive/55 bg-destructive/6 dark:border-destructive/45 dark:bg-destructive/8",
}

const BADGE_STYLES: Record<MetricState, string> = {
  healthy: "border-transparent bg-muted text-muted-foreground dark:bg-muted/70",
  warning:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  failed:
    "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20",
}

const TEXT_STYLES: Record<MetricState, string> = {
  healthy: "text-muted-foreground",
  warning: "text-amber-800 dark:text-amber-300",
  failed: "text-destructive",
}

function StateIcon({ state }: { state: MetricState }) {
  return state === "healthy" ? (
    <CheckCircle2Icon aria-hidden="true" />
  ) : state === "warning" ? (
    <AlertTriangleIcon aria-hidden="true" />
  ) : (
    <ShieldXIcon aria-hidden="true" />
  )
}

function StateBadge({ state }: { state: MetricState }) {
  return (
    <Badge variant="outline" className={BADGE_STYLES[state]}>
      <StateIcon state={state} />
      {STATE_LABELS[state]}
    </Badge>
  )
}

function diskId(device: string) {
  return `disk-${device.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`
}

function membership(disk: SmartDiskStatus) {
  if (!disk.pool_name) {
    return null
  }
  return disk.vdev_name
    ? `${disk.pool_name} / ${disk.vdev_name}`
    : disk.pool_name
}

function temperatureStatus(disk: SmartDiskStatus, metric?: SmartMetric) {
  if (disk.temperature_celsius === null) {
    return metric ? "Temperature sensor unavailable" : null
  }
  return metric?.state === "warning" ? "Elevated" : null
}

function DiskSummary({ disk }: { disk: SmartDiskStatus }) {
  const smart = disk.metrics.find((metric) => metric.key === "smart-status")
  const temperature = disk.metrics.find(
    (metric) => metric.key === "temperature"
  )
  const noteworthy = disk.metrics.filter(
    (metric) =>
      !["smart-status", "temperature"].includes(metric.key) &&
      metric.state !== "healthy"
  )
  const temperatureMessage = temperatureStatus(disk, temperature)

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-sans text-xs">
        <strong className={cn(smart && TEXT_STYLES[smart.state])}>
          SMART {smart?.value.toLowerCase() ?? "data unavailable"}
        </strong>
        {noteworthy.length === 0 && !temperatureMessage && (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <span className="text-muted-foreground">No errors</span>
          </>
        )}
        {temperatureMessage && (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <span className={TEXT_STYLES[temperature?.state ?? "warning"]}>
              {temperatureMessage}
            </span>
          </>
        )}
      </div>

      {noteworthy.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {noteworthy.map((metric) => (
            <span
              key={metric.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-sans text-[0.6875rem]",
                BADGE_STYLES[metric.state]
              )}
              title={metric.detail}
            >
              <span>{metric.label}</span>
              <strong className="font-mono tabular-nums">{metric.value}</strong>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function DiskDetails({ disk }: { disk: SmartDiskStatus }) {
  return (
    <details className="group mt-3 border-t pt-2 font-sans text-[0.6875rem] text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
        Technical details
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <span>Protocol</span>
          <div className="font-mono text-foreground">{disk.protocol}</div>
        </div>
        <div className="min-w-0">
          <span>WWN</span>
          <div
            className="truncate font-mono text-foreground"
            title={disk.wwn ?? undefined}
          >
            {disk.wwn ?? "Not reported"}
          </div>
        </div>
        {disk.metrics.map((metric) => (
          <div key={metric.key} title={metric.detail}>
            <span>{metric.label}</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-foreground">{metric.value}</span>
              {metric.state !== "healthy" && (
                <span className={TEXT_STYLES[metric.state]}>
                  {STATE_LABELS[metric.state]}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

export function DiskHealthView({ health }: { health: DiskHealthStatus }) {
  const disks = [...health.disks].sort(
    (left, right) => STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state]
  )
  const firstAttention = disks.find((disk) => disk.state !== "healthy")

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
          ATTENTION_STYLES[health.state]
        )}
        role={health.state === "healthy" ? "status" : "alert"}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("shrink-0", TEXT_STYLES[health.state])}>
            <StateIcon state={health.state} />
          </span>
          <div className="min-w-0">
            <div className="font-heading text-sm font-semibold">
              Physical disks
            </div>
            <div className="font-sans text-xs text-muted-foreground">
              {health.message}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {firstAttention && (
            <a
              href={`#${diskId(firstAttention.device)}`}
              className="inline-flex items-center gap-1 rounded-sm font-sans text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              View disk
              <ArrowDownIcon className="size-3" aria-hidden="true" />
            </a>
          )}
          <StateBadge state={health.state} />
          <PanelHelp source="smartctl -a -j per discovered disk; lsblk -J -b -d for identity; zpool status for pool membership">
            SMART is vendor-reported drive telemetry. A passing result is
            reassuring, but it is not a substitute for tested backups. Counts
            are lifetime values; trends can matter as much as current values.
            Identity is supplemented from lsblk and pool membership from zpool
            status when device identifiers can be matched safely.
          </PanelHelp>
        </div>
      </div>

      {disks.length === 0 ? (
        <div className="rounded-lg border px-4 py-8 text-center">
          <div className="font-heading font-medium">No disks discovered</div>
          <p className="mt-1 font-sans text-xs text-muted-foreground">
            {health.message}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {disks.map((disk) => {
            const temperature = disk.metrics.find(
              (metric) => metric.key === "temperature"
            )
            const temperatureMessage = temperatureStatus(disk, temperature)
            const poolMembership = membership(disk)

            return (
              <section
                id={diskId(disk.device)}
                key={`${disk.device}-${disk.serial ?? disk.model}`}
                className={cn(
                  "min-w-0 scroll-mt-4 rounded-lg border p-3",
                  ATTENTION_STYLES[disk.state]
                )}
                aria-label={`${disk.model}: ${STATE_LABELS[disk.state]}`}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("shrink-0", TEXT_STYLES[disk.state])}>
                        <StateIcon state={disk.state} />
                      </span>
                      <h2 className="truncate font-heading text-sm font-semibold">
                        {disk.model}
                      </h2>
                      <StateBadge state={disk.state} />
                    </div>
                    <div className="mt-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
                      {disk.device} · {formatBytes(disk.capacity_bytes)}
                      {poolMembership ? ` · ${poolMembership}` : ""}
                    </div>
                    <div className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                      S/N {disk.serial ?? "not reported"}
                    </div>
                  </div>
                  <div className="max-w-36 text-right">
                    <div className="font-heading text-xl font-semibold tabular-nums">
                      {disk.temperature_celsius === null
                        ? temperature
                          ? "Temp unavailable"
                          : "Not supported"
                        : `${disk.temperature_celsius}°C`}
                    </div>
                    {temperatureMessage &&
                      disk.temperature_celsius !== null && (
                        <div
                          className={cn(
                            "font-sans text-[0.6875rem] font-medium",
                            TEXT_STYLES[temperature?.state ?? "warning"]
                          )}
                        >
                          {temperatureMessage}
                        </div>
                      )}
                  </div>
                </div>
                <DiskSummary disk={disk} />
                <DiskDetails disk={disk} />
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
