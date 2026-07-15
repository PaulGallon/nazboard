import { formatBytes, type DatasetStatus } from "@/lib/status"

type DonutSegment = {
  color: string
  label: string
  value: number
}

type DonutChartProps = {
  caption: string
  label: string
  segments: DonutSegment[]
  total: number
  value: string
}

const CHART_RADIUS = 40
const CHART_CIRCUMFERENCE = 2 * Math.PI * CHART_RADIUS

function DonutChart({
  caption,
  label,
  segments,
  total,
  value,
}: DonutChartProps) {
  const safeTotal = Math.max(total, 0)
  const chartSegments = segments.reduce<{
    consumed: number
    items: Array<DonutSegment & { length: number; offset: number }>
  }>(
    (result, segment) => {
      const available = Math.max(safeTotal - result.consumed, 0)
      const segmentValue = Math.min(Math.max(segment.value, 0), available)
      const length =
        safeTotal > 0 ? (segmentValue / safeTotal) * CHART_CIRCUMFERENCE : 0
      const offset =
        safeTotal > 0 ? (result.consumed / safeTotal) * CHART_CIRCUMFERENCE : 0

      return {
        consumed: result.consumed + segmentValue,
        items:
          length > 0
            ? [...result.items, { ...segment, length, offset }]
            : result.items,
      }
    },
    { consumed: 0, items: [] }
  ).items

  return (
    <svg
      viewBox="0 0 100 100"
      className="mx-auto aspect-square w-full max-w-80"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle
        cx="50"
        cy="50"
        r={CHART_RADIUS}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="12"
      />
      {chartSegments.map((segment) => (
        <circle
          key={segment.label}
          cx="50"
          cy="50"
          r={CHART_RADIUS}
          fill="none"
          stroke={segment.color}
          strokeWidth="12"
          strokeDasharray={`${segment.length} ${CHART_CIRCUMFERENCE - segment.length}`}
          strokeDashoffset={-segment.offset}
          transform="rotate(-90 50 50)"
        >
          <title>
            {segment.label}: {formatBytes(segment.value)}
          </title>
        </circle>
      ))}
      <text
        x="50"
        y="47"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-foreground font-mono text-[12px] font-semibold"
      >
        {value}
      </text>
      <text
        x="50"
        y="59"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-muted-foreground text-[5px]"
      >
        {caption}
      </text>
    </svg>
  )
}

function LegendSwatch({ color }: { color: string }) {
  return (
    <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" aria-hidden="true">
      <rect width="10" height="10" rx="2" fill={color} />
    </svg>
  )
}

type UsageDonutProps = {
  usedBytes: number
  availableBytes: number
  percent: number
}

export function UsageDonut({
  usedBytes,
  availableBytes,
  percent,
}: UsageDonutProps) {
  const segments: DonutSegment[] = [
    { label: "Used", value: usedBytes, color: "var(--chart-3)" },
    {
      label: "Available",
      value: availableBytes,
      color: "var(--chart-1)",
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <DonutChart
        caption="used"
        label={`${percent.toFixed(0)}% of pool space used`}
        segments={segments}
        total={usedBytes + availableBytes}
        value={`${percent.toFixed(0)}%`}
      />
      <div className="grid grid-cols-2 gap-3 text-sm">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className="flex flex-col gap-1 rounded-md border p-3"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <LegendSwatch color={segment.color} />
              {segment.label}
            </span>
            <strong>{formatBytes(segment.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

type DatasetUsageDonutProps = {
  dataset: DatasetStatus
  poolSizeBytes: number
}

const DATASET_COLORS = [
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
    { label: dataset.path, value: ownUsedBytes },
    ...dataset.children.map((child) => ({
      label: child.path,
      value: Math.max(child.used_bytes, 0),
    })),
  ].map((segment, index) => ({
    ...segment,
    color: DATASET_COLORS[index % DATASET_COLORS.length],
  }))
  const percent =
    poolSizeBytes > 0 ? (dataset.used_bytes / poolSizeBytes) * 100 : 0

  return (
    <div className="flex flex-col gap-3">
      <DonutChart
        caption="of pool"
        label={`${dataset.path} uses ${percent.toFixed(0)}% of its pool`}
        segments={segments}
        total={poolSizeBytes}
        value={`${percent.toFixed(0)}%`}
      />
      <div className="flex flex-col gap-2 text-sm">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <LegendSwatch color={segment.color} />
              <span className="truncate" title={segment.label}>
                {segment.label}
              </span>
            </div>
            <strong className="shrink-0">{formatBytes(segment.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
