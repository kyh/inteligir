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
  type?: DataChartType;
  data?: Array<Record<string, unknown>>;
  series?: DataChartSeries[];
  /** Field used for the x-axis (cartesian charts) or slice name (pie). */
  categoryKey?: string;
  height?: number;
  stacked?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  className?: string;
}

// Theme palette — falls back across these when a series has no explicit color.
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

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
    series.forEach((s, i) => {
      next[s.key] = { label: s.label ?? s.key, color: s.color ?? PALETTE[i % PALETTE.length] };
    });
    return next;
  }, [series]);

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

type RenderArgs = Required<
  Pick<DataChartProps, "type" | "data" | "series" | "categoryKey" | "stacked" | "showGrid" | "showLegend">
>;

function renderChart({ type, data, series, categoryKey, stacked, showGrid, showLegend }: RenderArgs) {
  const grid = showGrid ? <CartesianGrid vertical={false} /> : null;
  const xAxis = (
    <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} tickMargin={8} />
  );
  const yAxis = <YAxis tickLine={false} axisLine={false} width={32} />;
  const tooltip = <ChartTooltip content={<ChartTooltipContent />} />;
  const legend = showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null;
  const stackId = stacked ? "a" : undefined;

  switch (type) {
    case "pie": {
      const valueKey = series[0]?.key ?? "value";
      return (
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={categoryKey} hideLabel />} />
          <Pie data={data} dataKey={valueKey} nameKey={categoryKey}>
            {data.map((row, i) => (
              <Cell key={String(row[categoryKey] ?? i)} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          {showLegend ? <ChartLegend content={<ChartLegendContent nameKey={categoryKey} />} /> : null}
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
              stackId={stackId}
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
            <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={4} stackId={stackId} />
          ))}
        </BarChart>
      );
  }
}
