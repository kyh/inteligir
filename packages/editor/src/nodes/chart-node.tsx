import type { PlateElementProps } from "platejs/react";

import { ChartGridEditor, emitChartPayload } from "./chart-grid";
import { RichBlock } from "./rich-block-chrome";
import { parseChartPayload } from "./chart-payload";
import type { ChartPayload } from "./chart-payload";

const W = 480;
const H = 200;
const PAD = { bottom: 28, left: 34, right: 8, top: 12 };

interface Series {
  color?: string | undefined;
  data: { color?: string | undefined; label: string; value: number }[];
  name?: string | undefined;
}

const seriesOf: (chart: ChartPayload) => Series[] = (chart: ChartPayload) => {
  if ("series" in chart) {
    return chart.series;
  }

  return [{ data: chart.data }] satisfies Series[];
};

const themeColor = (index: number, explicit?: string) =>
  explicit ?? `var(--chart-${String((index % 5) + 1)})`;

const bounds = (series: Series[]) => {
  const values = series.flatMap((row) => row.data.map((point) => point.value));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);

  return (max === min ? { max: min + 1, min } : { max, min }) satisfies {
    max: number;
    min: number;
  };
};

const yOf = (value: number, min: number, max: number) => {
  const usable = H - PAD.top - PAD.bottom;

  return PAD.top + usable * (1 - (value - min) / (max - min));
};

const ChartSvg = ({ chart }: { chart: ChartPayload }) => {
  const series = seriesOf(chart);
  const labels = series[0]?.data.map((point) => point.label) ?? [];
  const { max, min } = bounds(series);
  const plotWidth = W - PAD.left - PAD.right;
  const slot = plotWidth / Math.max(1, labels.length);
  const showGrid = chart.options?.showGrid ?? true;
  const zeroY = yOf(0, min, max);

  const bars = chart.type === "bar" || chart.type === "stacked-bar";
  const barWidth = bars ? (slot * 0.7) / (chart.type === "bar" ? series.length : 1) : 0;

  const linePoints = (row: Series) =>
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
};

const ChartFrame = ({ chart }: { chart: ChartPayload }) => (
  <div className="px-2 py-1">
    <ChartSvg chart={chart} />
  </div>
);

export const ChartElement = (props: PlateElementProps) => (
  <RichBlock
    {...props}
    label="chart"
    parse={parseChartPayload}
    titleOf={(chart) => chart.title}
    renderView={(chart) => <ChartFrame chart={chart} />}
    structured={{
      label: "Edit data",
      renderEditor: (chart, write) => (
        <>
          <ChartFrame chart={chart} />
          <div className="border-t border-border/60">
            <ChartGridEditor
              chart={chart}
              onCommit={(next) => {
                write(emitChartPayload(next));
              }}
            />
          </div>
        </>
      ),
    }}
  />
);
