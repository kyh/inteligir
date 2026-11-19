import { useState } from "react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";

import type { ChartPayload } from "./chart-node";

interface ChartGridView {
  labels: string[];
  seriesNames: string[] | null;
  values: number[][];
}

export const chartGridView = (chart: ChartPayload) => {
  if ("data" in chart) {
    return {
      labels: chart.data.map((point) => point.label),
      seriesNames: null,
      values: [chart.data.map((point) => point.value)],
    } satisfies ChartGridView | null;
  }

  const labels = chart.series[0]?.data.map((point) => point.label) ?? [];

  for (const row of chart.series) {
    if (row.data.length !== labels.length) {
      return null;
    }

    if (row.data.some((point, i) => point.label !== labels[i])) {
      return null;
    }
  }

  return {
    labels,
    seriesNames: chart.series.map((row) => row.name),
    values: chart.series.map((row) => row.data.map((point) => point.value)),
  } satisfies ChartGridView | null;
};

export const emitChartPayload = (chart: ChartPayload) => JSON.stringify(chart, null, 2);

const mapPoints = (
  chart: ChartPayload,
  map: (
    points: { color?: string | undefined; label: string; value: number }[],
    column: number,
  ) => { color?: string | undefined; label: string; value: number }[],
) => {
  if ("data" in chart) {
    return { ...chart, data: map(chart.data, 0) } satisfies ChartPayload;
  }

  return {
    ...chart,
    series: chart.series.map((row, column) => ({ ...row, data: map(row.data, column) })),
  } satisfies ChartPayload;
};

export const chartWithCellValue = (
  chart: ChartPayload,
  column: number,
  row: number,
  value: number,
) =>
  mapPoints(chart, (points, pointsColumn) =>
    pointsColumn === column
      ? points.map((point, i) => (i === row ? { ...point, value } : point))
      : points,
  );

export const chartWithRowLabel = (chart: ChartPayload, row: number, label: string) =>
  mapPoints(chart, (points) => points.map((point, i) => (i === row ? { ...point, label } : point)));

const chartWithSeriesName = (chart: ChartPayload, column: number, name: string) => {
  if ("data" in chart) {
    return chart;
  }

  return {
    ...chart,
    series: chart.series.map((row, i) => (i === column ? { ...row, name } : row)),
  } satisfies ChartPayload;
};

export const chartWithRowAdded = (chart: ChartPayload) => {
  const count = "data" in chart ? chart.data.length : (chart.series[0]?.data.length ?? 0);
  const label = `Label ${String(count + 1)}`;

  return mapPoints(chart, (points) => [...points, { label, value: 0 }]);
};

export const chartWithRowRemoved = (chart: ChartPayload, row: number) => {
  const count = "data" in chart ? chart.data.length : (chart.series[0]?.data.length ?? 0);

  if (count <= 1) {
    return null;
  }

  return mapPoints(chart, (points) => points.filter((_, i) => i !== row));
};

export const chartWithSeriesAdded: (chart: ChartPayload) => ChartPayload | null = (
  chart: ChartPayload,
) => {
  if ("data" in chart) {
    return null;
  }

  const labels = chart.series[0]?.data.map((point) => point.label) ?? [];

  return {
    ...chart,
    series: [
      ...chart.series,
      {
        data: labels.map((label) => ({ label, value: 0 })),
        name: `Series ${String(chart.series.length + 1)}`,
      },
    ],
  } satisfies ChartPayload | null;
};

export const chartWithSeriesRemoved = (chart: ChartPayload, column: number) => {
  if ("data" in chart) {
    return null;
  }

  if (chart.series.length <= 1) {
    return null;
  }

  return {
    ...chart,
    series: chart.series.filter((_, i) => i !== column),
  } satisfies ChartPayload | null;
};

const CellInput = ({
  align,
  ariaLabel,
  onCommit,
  text,
}: {
  align: "left" | "right";
  ariaLabel: string;
  onCommit: (text: string) => void;
  text: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState(text);

  if (shown !== text) {
    setShown(text);
    setDraft(null);
  }

  const commit = () => {
    if (draft !== null && draft !== text) {
      onCommit(draft);
    }

    setDraft(null);
  };

  return (
    <input
      aria-label={ariaLabel}
      value={draft ?? text}
      spellCheck={false}
      className={cn(
        "w-full min-w-14 bg-transparent px-1.5 py-0.5 font-mono text-body outline-none",
        "rounded-sm focus:bg-background focus:ring-1 focus:ring-border",
        align === "right" ? "text-right" : "text-left",
      )}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeComposing(event)) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
};

export const ChartGridEditor = ({
  chart,
  onCommit,
}: {
  chart: ChartPayload;
  onCommit: (next: ChartPayload) => void;
}) => {
  const view = chartGridView(chart);

  if (view === null) {
    return (
      <div className="px-3 py-2 text-body text-muted-foreground">
        The series disagree on labels, which the grid cannot show faithfully. Edit the payload
        instead.
      </div>
    );
  }

  const columns = view.values.length;

  return (
    <div className="px-2 py-1.5">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-1/3 border-b border-border/60 px-1.5 pb-1 text-left text-caption font-normal text-muted-foreground">
              Label
            </th>
            {Array.from({ length: columns }, (_, column) => (
              <th
                key={column}
                className="border-b border-border/60 px-1.5 pb-1 text-right text-caption font-normal text-muted-foreground"
              >
                {view.seriesNames === null ? (
                  "Value"
                ) : (
                  <CellInput
                    align="right"
                    ariaLabel={`Series ${String(column + 1)} name`}
                    text={view.seriesNames[column] ?? ""}
                    onCommit={(text) => {
                      if (text.trim() !== "") {
                        onCommit(chartWithSeriesName(chart, column, text));
                      }
                    }}
                  />
                )}
              </th>
            ))}
            <th aria-label="Remove row" className="w-6 border-b border-border/60" />
          </tr>
        </thead>
        <tbody>
          {view.labels.map((label, row) => (
            <tr key={row} className="group/chartrow">
              <td className="px-0.5">
                <CellInput
                  align="left"
                  ariaLabel={`Row ${String(row + 1)} label`}
                  text={label}
                  onCommit={(text) => {
                    onCommit(chartWithRowLabel(chart, row, text));
                  }}
                />
              </td>
              {Array.from({ length: columns }, (_, column) => (
                <td key={column} className="px-0.5">
                  <CellInput
                    align="right"
                    ariaLabel={`Row ${String(row + 1)} value ${String(column + 1)}`}
                    text={String(view.values[column]?.[row] ?? 0)}
                    onCommit={(text) => {
                      const value = Number(text.trim());

                      if (text.trim() !== "" && Number.isFinite(value)) {
                        onCommit(chartWithCellValue(chart, column, row, value));
                      }
                    }}
                  />
                </td>
              ))}
              <td className="w-6 text-center">
                <Tooltip content={`Remove row ${String(row + 1)}`}>
                  <button
                    type="button"
                    aria-label={`Remove row ${String(row + 1)}`}
                    className="text-body text-muted-foreground opacity-0 group-hover/chartrow:opacity-100 hover:text-destructive"
                    onClick={() => {
                      const next = chartWithRowRemoved(chart, row);

                      if (next !== null) {
                        onCommit(next);
                      }
                    }}
                  >
                    ×
                  </button>
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 pt-1.5 text-body text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => {
            onCommit(chartWithRowAdded(chart));
          }}
        >
          + Row
        </button>
        {"series" in chart ? (
          <>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => {
                const next = chartWithSeriesAdded(chart);

                if (next !== null) {
                  onCommit(next);
                }
              }}
            >
              + Series
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => {
                const next = chartWithSeriesRemoved(chart, chart.series.length - 1);

                if (next !== null) {
                  onCommit(next);
                }
              }}
            >
              − Series
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
};
