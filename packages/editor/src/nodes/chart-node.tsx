// No chart library: four shapes over one axis, and inline SVG keeps the render CSP-inert.
// An invalid payload stays code; the bytes are never touched.

import { z } from "zod";
import { type PlateElementProps, PlateElement } from "platejs/react";
import { useState } from "react";

import { stringProp } from "@repo/editor/node-props";

import { ChartGridEditor, emitChartPayload } from "./chart-grid";
import { DegradedPayloadView, RichBlockCard, PayloadEditor } from "./rich-block-chrome";
import { setBlockValue } from "./rich-block-value";

const NAMED_COLORS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "gray",
  "grey",
  "cyan",
  "magenta",
  "lime",
  "navy",
  "teal",
  "olive",
  "maroon",
  "aqua",
  "silver",
  "fuchsia",
]);

const colorSchema = z
  .string()
  .refine(
    (value) =>
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u.test(value) || NAMED_COLORS.has(value),
    { message: "color must be #RGB/#RRGGBB/#RRGGBBAA or a named color" },
  );

const pointSchema = z
  .object({ color: colorSchema.optional(), label: z.string(), value: z.number() })
  .strict();

const seriesSchema = z
  .object({ color: colorSchema.optional(), data: z.array(pointSchema).min(1), name: z.string() })
  .strict();

const optionsSchema = z
  .object({
    height: z.number().positive().optional(),
    palette: z.enum(["classic", "accessible", "mono"]).optional(),
    showGrid: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    width: z.number().positive().optional(),
    xAxisLabel: z.string().optional(),
    yAxisLabel: z.string().optional(),
  })
  .strict();

// a plain union: both branches share "bar", which zod's discriminator refuses; the series
// branch omitting "stacked-bar" is the one-data-array rule.
const chartSchema = z.union([
  z
    .object({
      data: z.array(pointSchema).min(1),
      options: optionsSchema.optional(),
      title: z.string().optional(),
      type: z.enum(["bar", "line", "area", "stacked-bar"]),
    })
    .strict(),
  z
    .object({
      options: optionsSchema.optional(),
      series: z.array(seriesSchema).min(1),
      title: z.string().optional(),
      type: z.enum(["bar", "line", "area"]),
    })
    .strict(),
]);

export type ChartPayload = z.infer<typeof chartSchema>;

export type ChartParse = { ok: true; chart: ChartPayload } | { ok: false; reason: string };

export function parseChartPayload(value: string): ChartParse {
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return { ok: false, reason: "The payload is not valid JSON." };
  }
  const parsed = chartSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `Not a chart: ${first?.message ?? "shape mismatch"}` };
  }
  return { chart: parsed.data, ok: true };
}

const W = 480;
const H = 200;
const PAD = { bottom: 28, left: 34, right: 8, top: 12 };

type Series = {
  color?: string | undefined;
  data: { color?: string | undefined; label: string; value: number }[];
  name?: string | undefined;
};

function seriesOf(chart: ChartPayload): Series[] {
  if ("series" in chart) return chart.series;
  return [{ data: chart.data }];
}

function themeColor(index: number, explicit?: string): string {
  return explicit ?? `var(--chart-${String((index % 5) + 1)})`;
}

function bounds(series: Series[]): { max: number; min: number } {
  const values = series.flatMap((row) => row.data.map((point) => point.value));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return max === min ? { max: min + 1, min } : { max, min };
}

function yOf(value: number, min: number, max: number): number {
  const usable = H - PAD.top - PAD.bottom;
  return PAD.top + usable * (1 - (value - min) / (max - min));
}

function ChartSvg({ chart }: { chart: ChartPayload }) {
  const series = seriesOf(chart);
  const labels = series[0]?.data.map((point) => point.label) ?? [];
  const { max, min } = bounds(series);
  const plotWidth = W - PAD.left - PAD.right;
  const slot = plotWidth / Math.max(1, labels.length);
  const showGrid = chart.options?.showGrid ?? true;
  const zeroY = yOf(0, min, max);

  const bars = chart.type === "bar" || chart.type === "stacked-bar";
  const barWidth = bars ? (slot * 0.7) / (chart.type === "bar" ? series.length : 1) : 0;

  const linePoints = (row: Series): string =>
    row.data
      .map(
        (point, i) =>
          `${String(PAD.left + slot * i + slot / 2)},${String(yOf(point.value, min, max))}`,
      )
      .join(" ");

  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="img"
      aria-label={chart.title ?? "chart"}
      className="w-full"
    >
      {showGrid
        ? [0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + (H - PAD.top - PAD.bottom) * f}
              y2={PAD.top + (H - PAD.top - PAD.bottom) * f}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
          ))
        : null}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
      />
      <text x={4} y={PAD.top + 4} className="fill-muted-foreground" fontSize={9}>
        {String(max)}
      </text>
      <text x={4} y={H - PAD.bottom} className="fill-muted-foreground" fontSize={9}>
        {String(min)}
      </text>

      {bars
        ? series.map((row, s) =>
            row.data.map((point, i) => {
              const y = yOf(Math.max(0, point.value), min, max);
              const height = Math.abs(yOf(point.value, min, max) - zeroY);
              const x =
                chart.type === "bar"
                  ? PAD.left + slot * i + slot * 0.15 + barWidth * s
                  : PAD.left + slot * i + slot * 0.15;
              return (
                <rect
                  key={`${String(s)}-${String(i)}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(1, height)}
                  fill={themeColor(s, point.color ?? row.color)}
                >
                  <title>{`${point.label}: ${String(point.value)}`}</title>
                </rect>
              );
            }),
          )
        : series.map((row, s) => (
            <g key={row.name ?? String(s)}>
              {chart.type === "area" ? (
                <polygon
                  points={`${String(PAD.left + slot / 2)},${String(zeroY)} ${linePoints(row)} ${String(
                    PAD.left + slot * (row.data.length - 1) + slot / 2,
                  )},${String(zeroY)}`}
                  fill={themeColor(s, row.color)}
                  opacity={0.25}
                />
              ) : null}
              <polyline
                points={linePoints(row)}
                fill="none"
                stroke={themeColor(s, row.color)}
                strokeWidth={2}
              />
              {row.data.map((point, i) => (
                <circle
                  key={`${point.label}-${String(i)}`}
                  cx={PAD.left + slot * i + slot / 2}
                  cy={yOf(point.value, min, max)}
                  r={2.5}
                  fill={themeColor(s, row.color)}
                >
                  <title>{`${point.label}: ${String(point.value)}`}</title>
                </circle>
              ))}
            </g>
          ))}

      {labels.map((label, i) => (
        <text
          key={label + String(i)}
          x={PAD.left + slot * i + slot / 2}
          y={H - PAD.bottom + 14}
          textAnchor="middle"
          fontSize={9}
          className="fill-muted-foreground"
        >
          {label}
        </text>
      ))}
      {chart.options?.showLegend === true && "series" in chart ? (
        <g>
          {chart.series.map((row, s) => (
            <g
              key={row.name}
              transform={`translate(${String(PAD.left + s * 90)}, ${String(H - 4)})`}
            >
              <rect width={8} height={8} y={-8} fill={themeColor(s, row.color)} />
              <text x={12} fontSize={9} className="fill-muted-foreground">
                {row.name}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

export function ChartElement(props: PlateElementProps) {
  const [mode, setMode] = useState<"view" | "grid" | "raw">("view");
  const value = stringProp(props.element, "value") ?? "";
  const parsed = parseChartPayload(value);

  return (
    <PlateElement {...props}>
      <RichBlockCard
        label={parsed.ok ? (parsed.chart.title ?? "chart") : "chart"}
        actions={
          mode === "view" ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode(parsed.ok ? "grid" : "raw");
              }}
            >
              Edit data
            </button>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode("view");
              }}
            >
              Done
            </button>
          )
        }
      >
        {mode === "raw" ? (
          <PayloadEditor
            initial={value}
            validate={(next) => {
              const verdict = parseChartPayload(next);
              return verdict.ok ? null : verdict.reason;
            }}
            onCancel={() => {
              setMode("view");
            }}
            onSave={(next) => {
              setBlockValue(props.editor, props.element, next);
              setMode("view");
            }}
          />
        ) : mode === "grid" && parsed.ok ? (
          <>
            <div className="px-2 py-1">
              <ChartSvg chart={parsed.chart} />
            </div>
            <div className="border-t border-border/60">
              <ChartGridEditor
                chart={parsed.chart}
                onCommit={(next) => {
                  setBlockValue(props.editor, props.element, emitChartPayload(next));
                }}
                onRawEdit={() => {
                  setMode("raw");
                }}
              />
            </div>
          </>
        ) : parsed.ok ? (
          <div className="px-2 py-1">
            <ChartSvg chart={parsed.chart} />
          </div>
        ) : (
          <DegradedPayloadView reason={parsed.reason} value={value} />
        )}
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
}
