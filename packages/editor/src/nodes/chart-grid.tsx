// The chart block's inline data grid: labels down, one
// value column per series, editing whole cells and committing each change as
// one editor transaction through the block's one writer. Every transform here
// is a pure ChartPayload -> ChartPayload map that PRESERVES what the grid does
// not show — title, options, per-point and per-series colors — so a grid edit
// can never silently strip a field the raw editor would have kept.

import { useState } from "react";

import { cn } from "@repo/ui/lib/utils";

import type { ChartPayload } from "./chart-node";

export interface ChartGridView {
  labels: string[];
  /** Column headers; null for the single-data-array shapes (bar/stacked-bar
   *  without `series`), whose one column has no name to edit. */
  seriesNames: string[] | null;
  /** values[column][row], aligned to `labels`. */
  values: number[][];
}

/**
 * Project a chart onto the grid, or refuse. The schema allows multi-series
 * payloads whose series disagree on length or labels; a grid cell model cannot
 * hold that shape faithfully, so it stays raw-editor-only rather than being
 * quietly realigned.
 */
export function chartGridView(chart: ChartPayload): ChartGridView | null {
  if ("data" in chart) {
    return {
      labels: chart.data.map((point) => point.label),
      seriesNames: null,
      values: [chart.data.map((point) => point.value)],
    };
  }
  const labels = chart.series[0]?.data.map((point) => point.label) ?? [];
  for (const row of chart.series) {
    if (row.data.length !== labels.length) return null;
    if (row.data.some((point, i) => point.label !== labels[i])) return null;
  }
  return {
    labels,
    seriesNames: chart.series.map((row) => row.name),
    values: chart.series.map((row) => row.data.map((point) => point.value)),
  };
}

/** The one spelling a grid commit writes. A committed edit is a real edit, so
 *  the payload re-emits in this stable form; untouched blocks are never
 *  rewritten. */
export function emitChartPayload(chart: ChartPayload): string {
  return JSON.stringify(chart, null, 2);
}

function mapPoints(
  chart: ChartPayload,
  map: (
    points: { color?: string | undefined; label: string; value: number }[],
    column: number,
  ) => { color?: string | undefined; label: string; value: number }[],
): ChartPayload {
  if ("data" in chart) {
    return { ...chart, data: map(chart.data, 0) };
  }
  return {
    ...chart,
    series: chart.series.map((row, column) => ({ ...row, data: map(row.data, column) })),
  };
}

export function chartWithCellValue(
  chart: ChartPayload,
  column: number,
  row: number,
  value: number,
): ChartPayload {
  return mapPoints(chart, (points, pointsColumn) =>
    pointsColumn === column
      ? points.map((point, i) => (i === row ? { ...point, value } : point))
      : points,
  );
}

export function chartWithRowLabel(chart: ChartPayload, row: number, label: string): ChartPayload {
  return mapPoints(chart, (points) =>
    points.map((point, i) => (i === row ? { ...point, label } : point)),
  );
}

export function chartWithSeriesName(
  chart: ChartPayload,
  column: number,
  name: string,
): ChartPayload {
  if ("data" in chart) return chart;
  return {
    ...chart,
    series: chart.series.map((row, i) => (i === column ? { ...row, name } : row)),
  };
}

export function chartWithRowAdded(chart: ChartPayload): ChartPayload {
  const count = "data" in chart ? chart.data.length : (chart.series[0]?.data.length ?? 0);
  const label = `Label ${String(count + 1)}`;
  return mapPoints(chart, (points) => [...points, { label, value: 0 }]);
}

/** Null when the last row would go — the schema's min(1) is the floor. */
export function chartWithRowRemoved(chart: ChartPayload, row: number): ChartPayload | null {
  const count = "data" in chart ? chart.data.length : (chart.series[0]?.data.length ?? 0);
  if (count <= 1) return null;
  return mapPoints(chart, (points) => points.filter((_, i) => i !== row));
}

/** Series-shaped charts only; the single-data-array shapes (incl. stacked-bar,
 *  whose schema forbids `series`) have no column to add. */
export function chartWithSeriesAdded(chart: ChartPayload): ChartPayload | null {
  if ("data" in chart) return null;
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
  };
}

export function chartWithSeriesRemoved(chart: ChartPayload, column: number): ChartPayload | null {
  if ("data" in chart) return null;
  if (chart.series.length <= 1) return null;
  return { ...chart, series: chart.series.filter((_, i) => i !== column) };
}

// ---------------------------------------------------------------------------
// The editor. Each cell commits on blur/Enter as its own transaction (one
// undo step per committed cell), so the component holds no draft copy of the
// chart — the node's value is the single source and a commit re-renders it.
// ---------------------------------------------------------------------------

function CellInput({
  align,
  ariaLabel,
  onCommit,
  text,
}: {
  align: "left" | "right";
  ariaLabel: string;
  /** Answer false to refuse (the cell snaps back to the committed value). */
  onCommit: (text: string) => boolean;
  text: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (element: HTMLInputElement): void => {
    if (draft !== null && draft !== text && !onCommit(draft)) {
      element.value = text;
    }
    setDraft(null);
  };
  return (
    <input
      aria-label={ariaLabel}
      defaultValue={text}
      spellCheck={false}
      className={cn(
        "w-full min-w-14 bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none",
        "rounded-sm focus:bg-background focus:ring-1 focus:ring-border",
        align === "right" ? "text-right" : "text-left",
      )}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={(event) => {
        commit(event.target);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ChartGridEditor({
  chart,
  onCommit,
  onRawEdit,
}: {
  chart: ChartPayload;
  onCommit: (next: ChartPayload) => void;
  onRawEdit: () => void;
}) {
  const view = chartGridView(chart);
  if (view === null) {
    // Misaligned series: representable in JSON, not in cells.
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        The series disagree on labels, which the grid cannot show faithfully.{" "}
        <button type="button" className="underline hover:text-foreground" onClick={onRawEdit}>
          Edit raw JSON
        </button>
      </div>
    );
  }
  const columns = view.values.length;
  // Cells are uncontrolled (defaultValue); keying the table by the payload
  // remounts them after every commit, so a row removal can never leave a
  // neighbor showing the value of the row that used to sit there.
  const version = emitChartPayload(chart);
  return (
    <div className="px-2 py-1.5">
      <table key={version} className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-1/3 border-b border-border/60 px-1.5 pb-1 text-left text-[10px] font-normal text-muted-foreground">
              Label
            </th>
            {Array.from({ length: columns }, (_, column) => (
              <th
                key={column}
                className="border-b border-border/60 px-1.5 pb-1 text-right text-[10px] font-normal text-muted-foreground"
              >
                {view.seriesNames === null ? (
                  "Value"
                ) : (
                  <CellInput
                    align="right"
                    ariaLabel={`Series ${String(column + 1)} name`}
                    text={view.seriesNames[column] ?? ""}
                    onCommit={(text) => {
                      if (text.trim() === "") return false;
                      onCommit(chartWithSeriesName(chart, column, text));
                      return true;
                    }}
                  />
                )}
              </th>
            ))}
            <th className="w-6 border-b border-border/60" />
          </tr>
        </thead>
        <tbody>
          {view.labels.map((label, row) => (
            <tr key={`${label}-${String(row)}`} className="group/chartrow">
              <td className="px-0.5">
                <CellInput
                  align="left"
                  ariaLabel={`Row ${String(row + 1)} label`}
                  text={label}
                  onCommit={(text) => {
                    onCommit(chartWithRowLabel(chart, row, text));
                    return true;
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
                      if (text.trim() === "" || Number.isNaN(value)) return false;
                      onCommit(chartWithCellValue(chart, column, row, value));
                      return true;
                    }}
                  />
                </td>
              ))}
              <td className="w-6 text-center">
                <button
                  type="button"
                  aria-label={`Remove row ${String(row + 1)}`}
                  className="text-xs text-muted-foreground opacity-0 group-hover/chartrow:opacity-100 hover:text-destructive"
                  onClick={() => {
                    const next = chartWithRowRemoved(chart, row);
                    if (next !== null) onCommit(next);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 pt-1.5 text-xs text-muted-foreground">
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
                if (next !== null) onCommit(next);
              }}
            >
              + Series
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => {
                const next = chartWithSeriesRemoved(chart, chart.series.length - 1);
                if (next !== null) onCommit(next);
              }}
            >
              − Series
            </button>
          </>
        ) : null}
        <span className="flex-1" />
        <button type="button" className="hover:text-foreground" onClick={onRawEdit}>
          Raw JSON
        </button>
      </div>
    </div>
  );
}
