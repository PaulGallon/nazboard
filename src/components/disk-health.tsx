import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HardDriveIcon,
  ShieldAlertIcon,
  ThermometerIcon,
} from "lucide-react"

import { PanelHelp } from "@/components/panel-help"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  formatBytes,
  type DiskHealthStatus,
  type MetricState,
} from "@/lib/status"
import { cn } from "@/lib/utils"

const STATE_STYLES: Record<MetricState, string> = {
  good: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  bad: "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  critical: "border-destructive/30 bg-destructive/8 text-destructive",
}

function StateBadge({ state }: { state: MetricState }) {
  return (
    <Badge variant="outline" className={STATE_STYLES[state]}>
      {state === "good" ? (
        <CheckCircle2Icon />
      ) : state === "bad" ? (
        <AlertTriangleIcon />
      ) : (
        <ShieldAlertIcon />
      )}
      {state === "good" ? "Good" : state === "bad" ? "Bad" : "Critical"}
    </Badge>
  )
}

export function DiskHealthView({ health }: { health: DiskHealthStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className={cn("overflow-hidden", STATE_STYLES[health.state])}>
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full border bg-background/70 p-3">
              {health.state === "good" ? (
                <CheckCircle2Icon className="size-6" aria-hidden="true" />
              ) : (
                <ShieldAlertIcon className="size-6" aria-hidden="true" />
              )}
            </div>
            <div>
              <div className="font-heading text-lg font-semibold">
                Physical disk health
              </div>
              <p className="text-sm opacity-80">{health.message}</p>
            </div>
          </div>
          <StateBadge state={health.state} />
        </CardContent>
      </Card>

      {health.disks.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No disks discovered</EmptyTitle>
                <EmptyDescription>{health.message}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-2">
          {health.disks.map((disk) => {
            const remainingMetrics = disk.metrics.filter(
              (metric) => metric.key !== "temperature"
            )
            return (
              <Card key={`${disk.device}-${disk.serial ?? disk.model}`}>
                <CardHeader className="border-b">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-lg border bg-muted/50 p-2.5">
                      <HardDriveIcon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{disk.model}</CardTitle>
                      <CardDescription className="truncate">
                        {disk.device} · {disk.protocol} ·{" "}
                        {formatBytes(disk.capacity_bytes)}
                      </CardDescription>
                    </div>
                  </div>
                  <CardAction className="flex items-center gap-2">
                    <StateBadge state={disk.state} />
                    <PanelHelp source={`smartctl -a -j -d TYPE ${disk.device}`}>
                      SMART is vendor-reported drive telemetry. A good result is
                      reassuring, but it is not a substitute for tested backups.
                      Sector counts are lifetime counters; trends can matter as
                      much as their current values.
                    </PanelHelp>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <div
                      className={cn(
                        "flex min-h-32 flex-col justify-between rounded-xl border p-4",
                        disk.metrics.find(
                          (metric) => metric.key === "temperature"
                        )
                          ? STATE_STYLES[
                              disk.metrics.find(
                                (metric) => metric.key === "temperature"
                              )!.state
                            ]
                          : "bg-muted/30"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span className="flex items-center gap-2">
                          <ThermometerIcon className="size-4" /> Temperature
                        </span>
                        {disk.metrics.find(
                          (metric) => metric.key === "temperature"
                        ) && (
                          <StateBadge
                            state={
                              disk.metrics.find(
                                (metric) => metric.key === "temperature"
                              )!.state
                            }
                          />
                        )}
                      </div>
                      <div className="font-heading text-4xl font-semibold tabular-nums">
                        {disk.temperature_celsius === null
                          ? "Unknown"
                          : `${disk.temperature_celsius}°C`}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {remainingMetrics.map((metric) => (
                        <div
                          key={metric.key}
                          className={cn(
                            "flex min-h-28 flex-col justify-between rounded-xl border p-3",
                            STATE_STYLES[metric.state]
                          )}
                          title={metric.detail}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-medium opacity-80">
                              {metric.label}
                            </span>
                            <StateBadge state={metric.state} />
                          </div>
                          <div className="text-2xl font-semibold tabular-nums">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span>{disk.status}</span>
                    {disk.serial && <span>Serial {disk.serial}</span>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
