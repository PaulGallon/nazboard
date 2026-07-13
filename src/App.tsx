import * as React from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  TerminalIcon,
} from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { UsageDonut } from "@/components/usage-donut"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  fetchStatus,
  findDataset,
  flattenDatasets,
  formatBytes,
  stateLabel,
  type CommandResult,
  type DatasetStatus,
  type PoolStatus,
  type Selection,
  type State,
  type StatusPayload,
} from "@/lib/status"

const REFRESH_MS = 60_000

function statusVariant(
  state: State
): React.ComponentProps<typeof Badge>["variant"] {
  if (state === "error") {
    return "destructive"
  }
  if (state === "warn") {
    return "outline"
  }
  return "secondary"
}

function poolState(pool: PoolStatus): State {
  return pool.health.toUpperCase() === "ONLINE" ? "ok" : "error"
}

function DiagnosticOutput({ command }: { command: CommandResult }) {
  const output = [
    command.error ? `ERROR: ${command.error}` : null,
    command.stdout.trim(),
    command.stderr.trim() ? `STDERR:\n${command.stderr.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{command.title}</CardTitle>
            <CardDescription>{`$ ${command.command.join(" ")}`}</CardDescription>
          </div>
          <Badge
            variant={
              command.returncode === 0 && !command.error
                ? "secondary"
                : "destructive"
            }
          >
            {command.returncode === null
              ? "not run"
              : `exit ${command.returncode}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-56 rounded-md border">
          <pre className="p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {output || "(no output)"}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function Overview({ status }: { status: StatusPayload }) {
  const datasetCount = status.pools.flatMap((pool) =>
    flattenDatasets(pool.datasets)
  ).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
            <CardDescription>{status.overall.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={statusVariant(status.overall.state)}>
              {stateLabel(status.overall.state)}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pools</CardTitle>
            <CardDescription>Detected ZFS pools</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {status.pools.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Datasets</CardTitle>
            <CardDescription>Listed ZFS datasets</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {datasetCount}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issues</CardTitle>
          <CardDescription>
            Warnings and errors across commands, pools, and datasets
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.issues.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No issues detected</EmptyTitle>
                <EmptyDescription>{status.overall.message}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {status.issues.map((issue) => (
                <Alert key={`${issue.scope}-${issue.name}-${issue.message}`}>
                  <AlertCircleIcon />
                  <AlertTitle className="flex items-center gap-2">
                    {issue.name}
                    <Badge variant={statusVariant(issue.severity)}>
                      {stateLabel(issue.severity)}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription>{issue.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {status.commands.map((command) => (
          <DiagnosticOutput key={command.title} command={command} />
        ))}
      </div>
    </div>
  )
}

function PoolView({ pool }: { pool: PoolStatus }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>{pool.name}</CardTitle>
              <CardDescription>
                {formatBytes(pool.size_bytes)} total pool size
              </CardDescription>
            </div>
            <Badge variant={statusVariant(poolState(pool))}>
              {pool.health}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <UsageDonut
            usedBytes={pool.allocated_bytes}
            availableBytes={pool.free_bytes}
            percent={pool.used_percent}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Datasets</CardTitle>
          <CardDescription>{pool.datasets.length} root dataset</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {flattenDatasets(pool.datasets).map((dataset) => (
              <div
                key={dataset.path}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate">{dataset.path}</span>
                <Badge variant={statusVariant(dataset.state)}>
                  {dataset.used_percent.toFixed(0)}%
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DatasetView({ dataset }: { dataset: DatasetStatus }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>{dataset.path}</CardTitle>
              <CardDescription>{dataset.mountpoint}</CardDescription>
            </div>
            <Badge variant={statusVariant(dataset.state)}>
              {stateLabel(dataset.state)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <UsageDonut
            usedBytes={dataset.used_bytes}
            availableBytes={dataset.available_bytes}
            percent={dataset.used_percent}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Figures</CardTitle>
          <CardDescription>Reported by zfs list</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Referenced</span>
              <strong>{formatBytes(dataset.refer_bytes)}</strong>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Children</span>
              <strong>{dataset.children.length}</strong>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function LoadingView() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  )
}

export function App() {
  const [status, setStatus] = React.useState<StatusPayload | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<Selection>({
    kind: "overview",
  })

  React.useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const nextStatus = await fetchStatus()
        if (active) {
          setStatus(nextStatus)
          setError(null)
        }
      } catch (nextError) {
        if (active) {
          setError(String(nextError))
        }
      }
    }

    void load()
    const interval = window.setInterval(load, REFRESH_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const title =
    selection.kind === "overview"
      ? "Overview"
      : selection.kind === "pool"
        ? selection.id
        : selection.id

  const selectedPool =
    selection.kind === "pool" && status
      ? status.pools.find((pool) => pool.name === selection.id)
      : null
  const selectedDataset =
    selection.kind === "dataset" && status
      ? findDataset(status, selection.id)
      : null

  return (
    <SidebarProvider>
      <AppSidebar
        status={status}
        selection={selection}
        onNavigate={setSelection}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-3 px-4">
          <SidebarTrigger />
          <Separator
            orientation="vertical"
            className="data-[orientation=vertical]:h-4"
          />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-heading text-lg font-semibold">
                {title}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {status
                  ? `Updated ${new Date(status.generated_at).toLocaleString()}`
                  : "Loading status"}
              </p>
            </div>
            {status && (
              <Badge variant={statusVariant(status.overall.state)}>
                {status.overall.message}
              </Badge>
            )}
          </div>
        </header>
        <Separator />
        <main className="flex flex-1 flex-col gap-4 p-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Status unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!status ? (
            <LoadingView />
          ) : selection.kind === "overview" ? (
            <Overview status={status} />
          ) : selectedPool ? (
            <PoolView pool={selectedPool} />
          ) : selectedDataset ? (
            <DatasetView dataset={selectedDataset} />
          ) : (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>Selection unavailable</AlertTitle>
              <AlertDescription>
                Choose another pool or dataset from the sidebar.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ClockIcon />
            <span>Refreshes every 60 seconds</span>
            <TerminalIcon />
            <span>Read-only ZFS commands</span>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
