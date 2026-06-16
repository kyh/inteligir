"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@repo/ui/lib/utils";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@repo/ui/components/chart";

export type DataChartType = "line" | "bar" | "area" | "pie";
export type DataChartSeries = { key: string; label?: string; color?: string };

export interface DataChartProps {
  type?: DataChartType | undefined;
  data?: Array<Record<string, unknown>> | undefined;
  series?: DataChartSeries[] | undefined;
  /** Field used for the x-axis (cartesian charts) or slice name (pie). */
  categoryKey?: string | undefined;
  height?: number | undefined;
  stacked?: boolean | undefined;
  showLegend?: boolean | undefined;
  showGrid?: boolean | undefined;
  className?: string | undefined;
}

// Theme palette — falls back across these when a series has no explicit color.
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Cyclic palette lookup. The modulo keeps the index in range; the fallback
 * only exists to satisfy noUncheckedIndexedAccess. */
function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length] ?? PALETTE[0];
}

// Stable empty defaults so an omitted prop doesn't break referential equality.
const EMPTY_DATA: Array<Record<string, unknown>> = [];
const EMPTY_SERIES: DataChartSeries[] = [];

/**
 * A declarative, data-driven chart built on the shadcn chart primitives
 * (Recharts). Pass `data` (an array of row objects), `series` (the numeric
 * fields to plot) and a `categoryKey` (the x-axis / slice-name field).
 */
export function DataChart({
  type = "bar",
  data = EMPTY_DATA,
  series = EMPTY_SERIES,
  categoryKey = "name",
  height = 220,
  stacked = false,
  showLegend = false,
  showGrid = true,
  className,
}: DataChartProps) {
  const config = React.useMemo<ChartConfig>(() => {
    const next: ChartConfig = {};
    if (type === "pie") {
      // Pie slices are keyed by their category value (e.g. "Chrome"), which is
      // how the legend/tooltip resolve labels — config keyed by series names
      // would never match, leaving the legend as unlabeled dots.
      data.forEach((row, i) => {
        const name = String(row[categoryKey] ?? i);
        next[name] = { label: name, color: paletteColor(i) };
      });
    } else {
      series.forEach((s, i) => {
        next[s.key] = { label: s.label ?? s.key, color: s.color ?? paletteColor(i) };
      });
    }
    return next;
  }, [type, series, data, categoryKey]);

  const chart = renderChart({ type, data, series, categoryKey, stacked, showGrid, showLegend });

  return (
    <ChartContainer
      config={config}
      className={cn("w-full", className)}
      style={{ height, aspectRatio: "auto" }}
    >
      {chart}
    </ChartContainer>
  );
}

// Spelled out (not Required<Pick<DataChartProps, ...>>) because the public
// props include `| undefined` for exactOptionalPropertyTypes callers, while
// DataChart's destructuring defaults guarantee these are always present here.
type RenderArgs = {
  type: DataChartType;
  data: Array<Record<string, unknown>>;
  series: DataChartSeries[];
  categoryKey: string;
  stacked: boolean;
  showGrid: boolean;
  showLegend: boolean;
};

function renderChart({
  type,
  data,
  series,
  categoryKey,
  stacked,
  showGrid,
  showLegend,
}: RenderArgs) {
  const grid = showGrid ? <CartesianGrid vertical={false} /> : null;
  const xAxis = <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} tickMargin={8} />;
  const yAxis = <YAxis tickLine={false} axisLine={false} width={32} />;
  const tooltip = <ChartTooltip content={<ChartTooltipContent />} />;
  const legend = showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null;
  // Spread (rather than stackId={...}) so an unstacked chart omits the prop
  // entirely — recharts types stackId without `| undefined`.
  const stackProps = stacked ? { stackId: "a" } : {};

  switch (type) {
    case "pie": {
      const valueKey = series[0]?.key ?? "value";
      return (
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={categoryKey} hideLabel />} />
          <Pie data={data} dataKey={valueKey} nameKey={categoryKey}>
            {data.map((row, i) => (
              <Cell key={String(row[categoryKey] ?? i)} fill={paletteColor(i)} />
            ))}
          </Pie>
          {showLegend ? (
            <ChartLegend content={<ChartLegendContent nameKey={categoryKey} />} />
          ) : null}
        </PieChart>
      );
    }
    case "line":
      return (
        <LineChart data={data}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              fill={`var(--color-${s.key})`}
              fillOpacity={0.2}
              {...stackProps}
            />
          ))}
        </AreaChart>
      );
    case "bar":
    default:
      return (
        <BarChart data={data}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              radius={4}
              {...stackProps}
            />
          ))}
        </BarChart>
      );
  }
}
