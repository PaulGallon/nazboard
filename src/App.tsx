import * as React from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  HardDriveIcon,
  TerminalIcon,
} from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { PanelHelp } from "@/components/panel-help"
import { DatasetUsageDonut, UsageDonut } from "@/components/usage-donut"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  fetchStatus,
  findDataset,
  flattenDatasets,
  formatBytes,
  stateLabel,
  type CommandResult,
  type DatasetProperty,
  type DatasetStatus,
  type DiskStatus,
  type PoolStatus,
  type Selection,
  type SnapshotStatus,
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
  if (pool.health.toUpperCase() === "ONLINE") {
    return "ok"
  }
  return pool.health.toUpperCase() === "DEGRADED" ? "warn" : "error"
}

function deviceState(device: DiskStatus): State {
  const hasErrors =
    device.read_errors + device.write_errors + device.checksum_errors > 0
  if (device.state.toUpperCase() === "ONLINE" && !hasErrors) {
    return "ok"
  }
  if (device.state.toUpperCase() === "DEGRADED" && !hasErrors) {
    return "warn"
  }
  return "error"
}

function formatSnapshotDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown"
}

function propertyValue(properties: DatasetProperty[], propertyName: string) {
  return (
    properties.find((property) => property.property === propertyName)?.value ??
    "-"
  )
}

function displayPropertyValue(value: string, propertyName?: string) {
  if (value === "" || value === "-") {
    return "-"
  }

  if (propertyName === "sharenfs") {
    return value.replaceAll(",", ",\n")
  }

  const parsed = Number.parseInt(value, 10)
  if (/^\d+$/.test(value) && parsed >= 1024) {
    return formatBytes(parsed)
  }

  return value
}

function SnapshotsPanel({
  snapshots,
  snapshotUsedBytes,
  showDataset = false,
}: {
  snapshots: SnapshotStatus[]
  snapshotUsedBytes: number
  showDataset?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Snapshots</CardTitle>
        <CardDescription>
          {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(snapshotUsedBytes)} held in total
        </CardDescription>
        <CardAction>
          <PanelHelp source="zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots; zfs list -H -p -t snapshot -o name,used,refer,creation">
            Total snapshot space is the dataset&apos;s usedbysnapshots value:
            the space freed if all its snapshots were destroyed. Each row&apos;s
            used value is space unique to that snapshot, so row values do not
            necessarily add up to the total. Referenced is the data accessible
            through the snapshot.
          </PanelHelp>
        </CardAction>
      </CardHeader>
      <CardContent>
        {snapshots.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No snapshots found</EmptyTitle>
              <EmptyDescription>
                OpenZFS reported no snapshots for this selection.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {snapshots.map((snapshot, index) => (
              <React.Fragment key={snapshot.path}>
                {index > 0 && <Separator />}
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {showDataset ? snapshot.path : snapshot.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatSnapshotDate(snapshot.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-0">
                    <span className="text-muted-foreground">Unique</span>
                    <strong>{formatBytes(snapshot.used_bytes)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-0">
                    <span className="text-muted-foreground">Referenced</span>
                    <strong>{formatBytes(snapshot.refer_bytes)}</strong>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
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
        <CardTitle>{command.title}</CardTitle>
        <CardDescription>{`$ ${command.command.join(" ")}`}</CardDescription>
        <CardAction className="flex items-center gap-1">
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
          <PanelHelp source={command.command.join(" ")}>
            The unmodified standard output and error output from this fixed,
            read-only OpenZFS command. It is shown as text and is not
            interpreted on this page.
          </PanelHelp>
        </CardAction>
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

function RawView({ commands }: { commands: CommandResult[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {commands.map((command) => (
        <DiagnosticOutput key={command.title} command={command} />
      ))}
    </div>
  )
}

function Overview({ status }: { status: StatusPayload }) {
  const datasets = status.pools.flatMap((pool) =>
    flattenDatasets(pool.datasets)
  )
  const snapshotCount = datasets.reduce(
    (total, dataset) => total + dataset.snapshots.length,
    0
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
            <CardDescription>{status.overall.message}</CardDescription>
            <CardAction>
              <PanelHelp source="zpool status -x">
                OpenZFS&apos;s concise pool-health summary. Healthy means every
                imported pool reports no known health problem; warnings and
                command failures appear in Issues.
              </PanelHelp>
            </CardAction>
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
            <CardAction>
              <PanelHelp source="zpool list -H -o name,size,alloc,free,health">
                The number of imported storage pools returned by OpenZFS. A pool
                combines one or more top-level virtual devices into storage.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {status.pools.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Datasets</CardTitle>
            <CardDescription>Listed ZFS datasets</CardDescription>
            <CardAction>
              <PanelHelp source="zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots">
                The number of filesystems and volumes returned by OpenZFS,
                including nested datasets. Snapshots are counted separately.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {datasets.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Snapshots</CardTitle>
            <CardDescription>
              {formatBytes(
                status.pools.reduce(
                  (total, pool) => total + pool.snapshot_used_bytes,
                  0
                )
              )}{" "}
              held
            </CardDescription>
            <CardAction>
              <PanelHelp source="zfs list -H -p -t snapshot -o name,used,refer,creation">
                Point-in-time, read-only versions of datasets. The count comes
                from the snapshot list; held space uses each dataset&apos;s
                usedbysnapshots value to avoid double-counting shared blocks.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {snapshotCount}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issues</CardTitle>
          <CardDescription>
            Warnings and errors across commands, pools, and datasets
          </CardDescription>
          <CardAction>
            <PanelHelp source="All fixed status commands plus nazboard usage thresholds">
              Command failures, non-ONLINE pools, vdevs or disks, device error
              counters, and datasets at or above 75% usage. Usage reaches error
              severity at 85%.
            </PanelHelp>
          </CardAction>
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
    </div>
  )
}

function PoolView({ pool }: { pool: PoolStatus }) {
  const datasets = flattenDatasets(pool.datasets)
  const snapshots = datasets.flatMap((dataset) => dataset.snapshots)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{pool.name}</CardTitle>
            <CardDescription>
              {formatBytes(pool.size_bytes)} total pool size
            </CardDescription>
            <CardAction className="flex items-center gap-1">
              <Badge variant={statusVariant(poolState(pool))}>
                {pool.health}
              </Badge>
              <PanelHelp source="zpool list -H -o name,size,alloc,free,health">
                Pool size, allocated space, free space, and health reported by
                OpenZFS. The chart&apos;s percentage is allocated divided by
                allocated plus free.
              </PanelHelp>
            </CardAction>
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
            <CardDescription>
              {datasets.length} dataset{datasets.length === 1 ? "" : "s"}
            </CardDescription>
            <CardAction>
              <PanelHelp source="zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots">
                Filesystems and volumes in this pool. The percentage is each
                dataset&apos;s used space divided by used plus available space;
                available can also be constrained by quotas and reservations.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {datasets.map((dataset) => (
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

      <Card>
        <CardHeader>
          <CardTitle>Virtual devices</CardTitle>
          <CardDescription>
            {pool.vdevs.length} top-level vdev
            {pool.vdevs.length === 1 ? "" : "s"} and their leaf disks
          </CardDescription>
          <CardAction>
            <PanelHelp source="zpool status">
              A top-level vdev is a direct child of the pool root and may be a
              mirror, RAIDZ group, or single disk. Leaf disks are its physical
              endpoints. State and READ, WRITE, and CKSUM error counters come
              directly from the OpenZFS status table.
            </PanelHelp>
          </CardAction>
        </CardHeader>
        <CardContent>
          {pool.vdevs.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No vdev topology available</EmptyTitle>
                <EmptyDescription>
                  The zpool status output did not contain a device table.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {pool.vdevs.map((vdev) => (
                <div
                  key={`${vdev.class_name}-${vdev.name}`}
                  className="flex flex-col gap-3 rounded-md border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <HardDriveIcon />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{vdev.name}</div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <span>{vdev.type}</span>
                          <span>·</span>
                          <span>{vdev.class_name} class</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={statusVariant(deviceState(vdev))}>
                      {vdev.state}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_repeat(3,2.5rem)] gap-2 text-[0.625rem] text-muted-foreground">
                    <span>Disk</span>
                    <span>Status</span>
                    <span className="text-right">Read</span>
                    <span className="text-right">Write</span>
                    <span className="text-right">Cksum</span>
                  </div>
                  {vdev.disks.map((disk, diskIndex) => (
                    <div
                      key={`${disk.name}-${diskIndex}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto_repeat(3,2.5rem)] items-center gap-2"
                    >
                      <span className="truncate" title={disk.name}>
                        {disk.name}
                      </span>
                      <Badge variant={statusVariant(deviceState(disk))}>
                        {disk.state}
                      </Badge>
                      <span className="text-right tabular-nums">
                        {disk.read_errors}
                      </span>
                      <span className="text-right tabular-nums">
                        {disk.write_errors}
                      </span>
                      <span className="text-right tabular-nums">
                        {disk.checksum_errors}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SnapshotsPanel
        snapshots={snapshots}
        snapshotUsedBytes={pool.snapshot_used_bytes}
        showDataset
      />
    </div>
  )
}

function DatasetView({
  dataset,
  pool,
}: {
  dataset: DatasetStatus
  pool: PoolStatus
}) {
  const highlightedProperties = [
    ["Compression ratio", propertyValue(dataset.properties, "compressratio")],
    ["Compression", propertyValue(dataset.properties, "compression")],
    ["Quota", propertyValue(dataset.properties, "quota")],
    [
      "Record size",
      displayPropertyValue(propertyValue(dataset.properties, "recordsize")),
    ],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {highlightedProperties.map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardDescription>Reported by zfs get all</CardDescription>
            </CardHeader>
            <CardContent className="truncate text-2xl font-semibold tabular-nums">
              {value}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{dataset.path}</CardTitle>
            <CardDescription>
              {formatBytes(pool.size_bytes)} total pool size ·{" "}
              {dataset.mountpoint}
            </CardDescription>
            <CardAction className="flex items-center gap-1">
              <Badge variant={statusVariant(dataset.state)}>
                {stateLabel(dataset.state)}
              </Badge>
              <PanelHelp source="zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots">
                The chart scales this dataset&apos;s used space against the
                total pool size. When it has children, their complete subtree
                usage is shown separately and the remaining used space belongs
                to this dataset itself. The muted track is the rest of the pool.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent>
            <DatasetUsageDonut
              dataset={dataset}
              poolSizeBytes={pool.size_bytes}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Figures</CardTitle>
            <CardDescription>Reported by zfs list</CardDescription>
            <CardAction>
              <PanelHelp source="zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots">
                Referenced is data accessible directly through this dataset and
                may share blocks with snapshots or clones. Snapshot space is
                what would be freed by destroying all snapshots of this dataset.
              </PanelHelp>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Referenced</span>
                <strong>{formatBytes(dataset.refer_bytes)}</strong>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Snapshots</span>
                <strong>{formatBytes(dataset.snapshot_used_bytes)}</strong>
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
      <SnapshotsPanel
        snapshots={dataset.snapshots}
        snapshotUsedBytes={dataset.snapshot_used_bytes}
      />
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
          <CardDescription>
            {dataset.properties.length} values from zfs get all
          </CardDescription>
          <CardAction>
            <PanelHelp
              source={`zfs get -H -p -o name,property,value,source all ${dataset.path}`}
            >
              Dataset properties reported by OpenZFS. Values are shown as text
              from the command output; byte-sized numeric values are formatted
              for readability in this table.
            </PanelHelp>
          </CardAction>
        </CardHeader>
        <CardContent>
          {dataset.properties.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No properties available</EmptyTitle>
                <EmptyDescription>
                  The zfs get all command did not return properties for this
                  dataset.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="h-96 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataset.properties.map((property) => (
                    <TableRow key={property.property}>
                      <TableCell className="font-medium">
                        {property.property}
                      </TableCell>
                      <TableCell className="break-words whitespace-pre-wrap">
                        {displayPropertyValue(
                          property.value,
                          property.property
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{property.source}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
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
      : selection.kind === "raw"
        ? "Raw command output"
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
  const selectedDatasetPool =
    selectedDataset && status
      ? status.pools.find((pool) =>
          flattenDatasets(pool.datasets).some(
            (dataset) => dataset.path === selectedDataset.path
          )
        )
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
          ) : selection.kind === "raw" ? (
            <RawView commands={status.commands} />
          ) : selectedPool ? (
            <PoolView pool={selectedPool} />
          ) : selectedDataset && selectedDatasetPool ? (
            <DatasetView dataset={selectedDataset} pool={selectedDatasetPool} />
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
