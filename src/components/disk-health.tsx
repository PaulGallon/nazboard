import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ShieldAlertIcon,
} from "lucide-react"

import { PanelHelp } from "@/components/panel-help"
import { Badge } from "@/components/ui/badge"
import {
  formatBytes,
  type DiskHealthStatus,
  type MetricState,
  type SmartMetric,
} from "@/lib/status"
import { cn } from "@/lib/utils"

const STATE_STYLES: Record<MetricState, string> = {
  good: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  bad: "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  critical: "border-destructive/30 bg-destructive/8 text-destructive",
}

const STATE_LABELS: Record<MetricState, string> = {
  good: "Good",
  bad: "Bad",
  critical: "Critical",
}

const STATE_TEXT_STYLES: Record<MetricState, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  bad: "text-amber-700 dark:text-amber-300",
  critical: "text-destructive",
}

function StateIcon({ state }: { state: MetricState }) {
  return state === "good" ? (
    <CheckCircle2Icon aria-hidden="true" />
  ) : state === "bad" ? (
    <AlertTriangleIcon aria-hidden="true" />
  ) : (
    <ShieldAlertIcon aria-hidden="true" />
  )
}

function StateBadge({ state }: { state: MetricState }) {
  return (
    <Badge variant="outline" className={STATE_STYLES[state]}>
      <StateIcon state={state} />
      {STATE_LABELS[state]}
    </Badge>
  )
}

function MetricValue({ metric }: { metric: SmartMetric }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[0.6875rem] leading-none whitespace-nowrap",
        STATE_STYLES[metric.state]
      )}
      title={metric.detail}
    >
      <span className="opacity-75">{metric.label}</span>
      <strong className="tabular-nums">{metric.value}</strong>
      <span className="font-medium">{STATE_LABELS[metric.state]}</span>
    </span>
  )
}

export function DiskHealthView({ health }: { health: DiskHealthStatus }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
          STATE_STYLES[health.state]
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <StateIcon state={health.state} />
          <span className="font-heading font-semibold">Physical disks</span>
          <span className="truncate text-xs opacity-80">{health.message}</span>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={health.state} />
          <PanelHelp source="smartctl -a -j per discovered disk; lsblk -J -b -d for identity">
            SMART is vendor-reported drive telemetry. A good result is
            reassuring, but it is not a substitute for tested backups. Sector
            counts are lifetime counters; trends can matter as much as their
            current values. Make, model and WWN are supplemented from lsblk when
            SMART omits them.
          </PanelHelp>
        </div>
      </div>

      {health.disks.length === 0 ? (
        <div className="rounded-lg border px-4 py-8 text-center">
          <div className="font-medium">No disks discovered</div>
          <p className="mt-1 text-xs text-muted-foreground">{health.message}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-border">
          <div className="grid grid-cols-1 gap-px xl:grid-cols-2">
            {health.disks.map((disk) => {
              const temperature = disk.metrics.find(
                (metric) => metric.key === "temperature"
              )
              const metrics = disk.metrics.filter(
                (metric) => metric.key !== "temperature"
              )
              return (
                <section
                  key={`${disk.device}-${disk.serial ?? disk.model}`}
                  className="min-w-0 bg-background p-3"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <StateBadge state={disk.state} />
                        <div className="truncate text-sm font-semibold">
                          {disk.manufacturer ?? "Unknown make"} · {disk.model}
                        </div>
                      </div>
                      <div className="mt-1 truncate text-[0.6875rem] text-muted-foreground">
                        {disk.device} · {disk.protocol} ·{" "}
                        {formatBytes(disk.capacity_bytes)}
                        {disk.serial ? ` · S/N ${disk.serial}` : ""}
                      </div>
                      <div className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                        WWN {disk.wwn ?? "not reported"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-heading text-xl font-semibold tabular-nums">
                        {disk.temperature_celsius === null
                          ? "Unknown"
                          : `${disk.temperature_celsius}°C`}
                      </div>
                      <div
                        className={cn(
                          "text-[0.6875rem] font-medium",
                          temperature
                            ? STATE_TEXT_STYLES[temperature.state]
                            : "text-muted-foreground"
                        )}
                      >
                        {temperature
                          ? `${STATE_LABELS[temperature.state]} temperature`
                          : "No temperature"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {metrics.map((metric) => (
                      <MetricValue key={metric.key} metric={metric} />
                    ))}
                  </div>
                  {disk.state !== "good" && (
                    <div className="mt-1 text-[0.6875rem] text-muted-foreground">
                      {disk.status}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
