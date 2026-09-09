"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useCallback, useMemo, useState } from "react";
import type { HTMLAttributes, PointerEvent, ReactNode, RefAttributes } from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "cn";

const InsightCardGrid = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-card-grid"
    className={cn("grid w-full gap-2 sm:grid-cols-2", className)}
    {...props}
  />
);
InsightCardGrid.displayName = "InsightCardGrid";

const InsightCard = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-card"
    className={cn(
      "flex w-full flex-col overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
      className,
    )}
    {...props}
  />
);
InsightCard.displayName = "InsightCard";

export interface InsightCardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
}

const InsightCardHeader = ({
  className,
  children,
  actions,
  ref,
  ...props
}: InsightCardHeaderProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-card-header"
    className={cn("flex items-center justify-between gap-2 px-3 pt-3", className)}
    {...props}
  >
    <span className="text-[12.5px] font-medium text-ink-2">{children}</span>
    {actions}
  </div>
);
InsightCardHeader.displayName = "InsightCardHeader";

const insightDeltaVariants = cva("text-[12px] font-medium tabular-nums", {
  defaultVariants: { direction: "flat" },
  variants: {
    direction: {
      down: "text-destructive",
      flat: "text-ink-3",
      up: "text-emerald-600 dark:text-emerald-400",
    },
  },
});

export interface InsightCardMetricProps extends HTMLAttributes<HTMLDivElement> {
  delta?: ReactNode;
  direction?: "up" | "down" | "flat";
}

const InsightCardMetric = ({
  className,
  children,
  delta,
  direction,
  ref,
  ...props
}: InsightCardMetricProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-card-metric"
    className={cn("flex items-baseline gap-2 px-3 pt-1", className)}
    {...props}
  >
    <span className="text-[22px] leading-tight font-semibold text-ink tabular-nums">
      {children}
    </span>
    {delta === undefined ? null : (
      <span className={insightDeltaVariants({ direction })}>{delta}</span>
    )}
  </div>
);
InsightCardMetric.displayName = "InsightCardMetric";

export interface InsightSeries {
  id: string;
  label: string;
  /** oldest first; every series must share a length */
  points: readonly number[];
}

const pathFor = (points: readonly number[], width: number, height: number, pad: number): string => {
  if (points.length < 2) {
    return "";
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  return points
    .map((value, index) => {
      const x = index * stepX;
      const y = pad + (1 - (value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

export interface InsightChartProps extends Omit<HTMLAttributes<HTMLDivElement>, "onScrub"> {
  series: readonly InsightSeries[];
  height?: number;
  onScrub?: (index: number | null) => void;
  tooltip?: (index: number) => ReactNode;
}

const InsightChart = ({
  className,
  series,
  height = 120,
  onScrub,
  tooltip,
  ref,
  ...props
}: InsightChartProps & RefAttributes<HTMLDivElement>) => {
  const [hover, setHover] = useState<number | null>(null);
  const length = series[0]?.points.length ?? 0;

  const paths = useMemo(
    () => series.map((entry) => ({ d: pathFor(entry.points, 100, height, 6), id: entry.id })),
    [series, height],
  );

  const scrub = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (length < 2) {
        return;
      }
      const box = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      const index = Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1))));
      setHover(index);
      onScrub?.(index);
    },
    [length, onScrub],
  );

  const leave = useCallback(() => {
    setHover(null);
    onScrub?.(null);
  }, [onScrub]);

  return (
    <div
      ref={ref}
      data-slot="insight-chart"
      className={cn("relative w-full", className)}
      style={{ height }}
      onPointerMove={scrub}
      onPointerDown={scrub}
      onPointerLeave={leave}
      onPointerUp={leave}
      {...props}
    >
      <svg
        aria-hidden
        width="100%"
        height={height}
        viewBox={`0 0 100 ${String(height)}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {paths.map((path, index) => (
          <path
            key={path.id}
            d={path.d}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            stroke={index === 0 ? "var(--ink)" : "var(--ink-3)"}
            strokeDasharray={index === 0 ? undefined : "4 3"}
          />
        ))}
      </svg>
      {hover === null ? null : (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
            style={{ left: `${String((hover / Math.max(length - 1, 1)) * 100)}%` }}
          />
          {tooltip === undefined ? null : (
            <span
              className="pointer-events-none absolute top-1 -translate-x-1/2"
              style={{
                left: `${String(Math.min(Math.max((hover / Math.max(length - 1, 1)) * 100, 22), 78))}%`,
              }}
            >
              {tooltip(hover)}
            </span>
          )}
        </>
      )}
    </div>
  );
};
InsightChart.displayName = "InsightChart";

const InsightChartTooltip = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-chart-tooltip"
    className={cn(
      "flex flex-col gap-0.5 rounded-lg bg-surface-raised px-2 py-1.5 shadow-surface-3",
      "text-[11.5px] whitespace-nowrap text-ink-2",
      className,
    )}
    {...props}
  />
);
InsightChartTooltip.displayName = "InsightChartTooltip";

export interface InsightChartTooltipRowProps extends HTMLAttributes<HTMLDivElement> {
  value?: ReactNode;
}

const InsightChartTooltipRow = ({
  className,
  children,
  value,
  ref,
  ...props
}: InsightChartTooltipRowProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="insight-chart-tooltip-row"
    className={cn("flex items-center justify-between gap-3", className)}
    {...props}
  >
    <span>{children}</span>
    <span className="font-medium text-ink tabular-nums">{value}</span>
  </div>
);
InsightChartTooltipRow.displayName = "InsightChartTooltipRow";

export interface InsightChartLegendItemProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof insightDeltaVariants> {
  index?: number;
}

const InsightChartLegendItem = ({
  className,
  children,
  index = 0,
  ref,
  ...props
}: InsightChartLegendItemProps & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="insight-chart-legend-item"
    className={cn("flex items-center gap-1.5 text-[11.5px] text-ink-3", className)}
    {...props}
  >
    <span
      aria-hidden
      className={cn("h-0.5 w-3 rounded-full", index === 0 ? "bg-ink" : "bg-ink-3")}
      style={index === 0 ? undefined : { backgroundImage: "none", opacity: 0.7 }}
    />
    {children}
  </span>
);
InsightChartLegendItem.displayName = "InsightChartLegendItem";

export {
  InsightCardGrid,
  InsightCard,
  InsightCardHeader,
  InsightCardMetric,
  InsightChart,
  InsightChartTooltip,
  InsightChartTooltipRow,
  InsightChartLegendItem,
  insightDeltaVariants,
};
