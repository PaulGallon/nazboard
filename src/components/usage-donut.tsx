import { Label, Pie, PieChart } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatBytes } from "@/lib/status"

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
