import { Label, Pie, PieChart } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatBytes, type DatasetStatus } from "@/lib/status"

type UsageDonutProps = {
  usedBytes: number
  availableBytes: number
  percent: number
}

const chartConfig = {
  used: {
    label: "Used",
    color: "var(--chart-3)",
  },
  available: {
    label: "Available",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

const chartLabels: Record<string, string> = {
  used: "Used",
  available: "Available",
}

export function UsageDonut({
  usedBytes,
  availableBytes,
  percent,
}: UsageDonutProps) {
  const chartData = [
    { name: "used", value: usedBytes, fill: "var(--color-used)" },
    {
      name: "available",
      value: availableBytes,
      fill: "var(--color-available)",
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square max-h-80 min-h-64"
      >
        <PieChart accessibilityLayer>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="name"
                formatter={(value, name) => (
                  <div className="flex min-w-36 items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {chartLabels[String(name)]}
                    </span>
                    <span className="font-mono font-medium text-foreground">
                      {formatBytes(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={76}
            outerRadius={108}
            strokeWidth={6}
          >
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                  return null
                }

                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground font-mono text-3xl font-semibold"
                    >
                      {percent.toFixed(0)}%
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 24}
                      className="fill-muted-foreground text-xs"
                    >
                      used
                    </tspan>
                  </text>
                )
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="text-muted-foreground">Used</span>
          <strong>{formatBytes(usedBytes)}</strong>
        </div>
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="text-muted-foreground">Available</span>
          <strong>{formatBytes(availableBytes)}</strong>
        </div>
      </div>
    </div>
  )
}

type DatasetUsageDonutProps = {
  dataset: DatasetStatus
  poolSizeBytes: number
}

const datasetColors = [
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--chart-1)",
]

export function DatasetUsageDonut({
  dataset,
  poolSizeBytes,
}: DatasetUsageDonutProps) {
  const childUsedBytes = dataset.children.reduce(
    (total, child) => total + child.used_bytes,
    0
  )
  const ownUsedBytes = Math.max(dataset.used_bytes - childUsedBytes, 0)
  const segments = [
    { name: dataset.path, value: ownUsedBytes },
    ...dataset.children.map((child) => ({
      name: child.path,
      value: Math.max(child.used_bytes, 0),
    })),
  ].map((segment, index) => ({
    ...segment,
    fill: datasetColors[index % datasetColors.length],
  }))
  const percent =
    poolSizeBytes > 0 ? (dataset.used_bytes / poolSizeBytes) * 100 : 0
  const boundedPercent = Math.min(Math.max(percent, 0), 100)
  const chartConfig = Object.fromEntries(
    segments.map((segment) => [segment.name, { label: segment.name }])
  ) satisfies ChartConfig

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square max-h-80 min-h-64"
      >
        <PieChart accessibilityLayer>
          <Pie
            data={[
              {
                name: "pool-size",
                value: Math.max(poolSizeBytes, 0),
                fill: "var(--muted)",
                tooltipType: "none" as const,
              },
            ]}
            dataKey="value"
            nameKey="name"
            innerRadius={76}
            outerRadius={108}
            strokeWidth={0}
            isAnimationActive={false}
            tooltipType="none"
          />
          <ChartTooltip
            content={(tooltipProps) => {
              const visiblePayload = tooltipProps.payload?.filter(
                (item) => item.type !== "none"
              )
              if (!visiblePayload?.length) {
                return null
              }

              return (
                <ChartTooltipContent
                  active={tooltipProps.active}
                  payload={visiblePayload}
                  hideLabel
                  nameKey="name"
                  formatter={(value, name) => (
                    <div className="flex min-w-48 items-center justify-between gap-4">
                      <span className="max-w-64 truncate text-muted-foreground">
                        {String(name)}
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {formatBytes(Number(value))}
                      </span>
                    </div>
                  )}
                />
              )
            }}
          />
          <Pie
            data={segments}
            dataKey="value"
            nameKey="name"
            innerRadius={76}
            outerRadius={108}
            strokeWidth={6}
            startAngle={90}
            endAngle={90 - (boundedPercent / 100) * 360}
          >
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                  return null
                }

                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground font-mono text-3xl font-semibold"
                    >
                      {percent.toFixed(0)}%
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 24}
                      className="fill-muted-foreground text-xs"
                    >
                      of pool
                    </tspan>
                  </text>
                )
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex flex-col gap-2 text-sm">
        {segments.map((segment) => (
          <div
            key={segment.name}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: segment.fill }}
              />
              <span className="truncate" title={segment.name}>
                {segment.name}
              </span>
            </div>
            <strong className="shrink-0">{formatBytes(segment.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
