// The pure halves of rich-block editing: chart grid transforms (field
// preservation is the contract — a grid edit may never strip what it does not
// show) and canvas cell painting (untouched cells keep their exact original
// characters).

import { describe, expect, it } from "vitest";

import {
  clearCanvasGrid,
  paintCanvasCells,
  strokeSegmentCells,
} from "@repo/editor/nodes/canvas-sketch";
import {
  chartGridView,
  chartWithCellValue,
  chartWithRowAdded,
  chartWithRowLabel,
  chartWithRowRemoved,
  chartWithSeriesAdded,
  chartWithSeriesRemoved,
  emitChartPayload,
} from "@repo/editor/nodes/chart-grid";
import { parseChartPayload } from "@repo/editor/nodes/chart-node";
import { roundTrip } from "@repo/editor/markdown/markdown-doc";

function chartOf(payload: string) {
  const parsed = parseChartPayload(payload);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.chart;
}

describe("chartGridView", () => {
  it("projects single-series and multi-series shapes", () => {
    const single = chartGridView(
      chartOf('{"type":"bar","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}'),
    );
    expect(single).toEqual({ labels: ["Mon", "Tue"], seriesNames: null, values: [[12, 18]] });

    const multi = chartGridView(
      chartOf(
        '{"type":"line","series":[{"name":"A","data":[{"label":"Mon","value":1}]},{"name":"B","data":[{"label":"Mon","value":2}]}]}',
      ),
    );
    expect(multi).toEqual({ labels: ["Mon"], seriesNames: ["A", "B"], values: [[1], [2]] });
  });

  it("refuses misaligned series (raw-editor-only, never realigned)", () => {
    expect(
      chartGridView(
        chartOf(
          '{"type":"line","series":[{"name":"A","data":[{"label":"Mon","value":1}]},{"name":"B","data":[{"label":"Tue","value":2}]}]}',
        ),
      ),
    ).toBeNull();
    expect(
      chartGridView(
        chartOf(
          '{"type":"line","series":[{"name":"A","data":[{"label":"Mon","value":1}]},{"name":"B","data":[{"label":"Mon","value":2},{"label":"Tue","value":3}]}]}',
        ),
      ),
    ).toBeNull();
  });
});

describe("chart transforms preserve what the grid does not show", () => {
  const payload =
    '{"type":"bar","title":"T","options":{"showLegend":true},"data":[{"label":"a","value":1,"color":"red"},{"label":"b","value":2}]}';

  it("a cell edit keeps title, options and point colors (keys in schema order)", () => {
    const next = chartWithCellValue(chartOf(payload), 0, 0, 9);
    // The parse itself normalizes key order to the schema's; a committed grid
    // edit therefore re-emits in that one canonical spelling.
    expect(emitChartPayload(next)).toBe(
      JSON.stringify(
        {
          data: [
            { color: "red", label: "a", value: 9 },
            { label: "b", value: 2 },
          ],
          options: { showLegend: true },
          title: "T",
          type: "bar",
        },
        null,
        2,
      ),
    );
  });

  it("label edits, row add and row remove keep the rest", () => {
    const chart = chartOf(payload);
    const relabeled = chartWithRowLabel(chart, 1, "c");
    expect("data" in relabeled ? relabeled.data[1] : null).toEqual({ label: "c", value: 2 });

    const grown = chartWithRowAdded(chart);
    expect("data" in grown ? grown.data.length : 0).toBe(3);
    expect("data" in grown ? grown.data[2] : null).toEqual({ label: "Label 3", value: 0 });

    const shrunk = chartWithRowRemoved(chart, 0);
    expect(shrunk === null ? null : "data" in shrunk ? shrunk.data : null).toEqual([
      { label: "b", value: 2 },
    ]);
  });

  it("refuses removing the last row (schema min 1)", () => {
    const one = chartOf('{"type":"bar","data":[{"label":"a","value":1}]}');
    expect(chartWithRowRemoved(one, 0)).toBeNull();
  });

  it("series add/remove exist only for the series shape", () => {
    const single = chartOf('{"type":"bar","data":[{"label":"a","value":1}]}');
    expect(chartWithSeriesAdded(single)).toBeNull();
    expect(chartWithSeriesRemoved(single, 0)).toBeNull();

    const multi = chartOf(
      '{"type":"line","series":[{"name":"A","color":"navy","data":[{"label":"x","value":1}]}]}',
    );
    const grown = chartWithSeriesAdded(multi);
    expect(grown !== null && "series" in grown ? grown.series.length : 0).toBe(2);
    expect(grown !== null && "series" in grown ? grown.series[1] : null).toEqual({
      data: [{ label: "x", value: 0 }],
      name: "Series 2",
    });
    expect(grown !== null && "series" in grown ? grown.series[0]?.color : null).toBe("navy");
    expect(chartWithSeriesRemoved(multi, 0)).toBeNull();
  });

  it("every transform's emit re-parses as a valid chart", () => {
    const chart = chartOf(payload);
    for (const next of [
      chartWithCellValue(chart, 0, 1, -3),
      chartWithRowLabel(chart, 0, "renamed"),
      chartWithRowAdded(chart),
    ]) {
      expect(parseChartPayload(emitChartPayload(next)).ok).toBe(true);
    }
  });
});

describe("paintCanvasCells", () => {
  const base =
    '[inteligir:grid:v2]\n[inteligir:labels:[{"id":"l","text":"L","col":2,"row":0}]]\nab.\n.x.';

  it("paints # and preserves every untouched character and the labels line", () => {
    expect(paintCanvasCells(base, [{ col: 2, row: 0 }], true)).toBe(
      '[inteligir:grid:v2]\n[inteligir:labels:[{"id":"l","text":"L","col":2,"row":0}]]\nab#\n.x.',
    );
  });

  it("erases to . without normalizing neighbors", () => {
    expect(paintCanvasCells(base, [{ col: 1, row: 1 }], false)).toBe(
      '[inteligir:grid:v2]\n[inteligir:labels:[{"id":"l","text":"L","col":2,"row":0}]]\nab.\n...',
    );
  });

  it("pads short rows and adds rows only as far as a painted cell requires", () => {
    expect(paintCanvasCells("[inteligir:grid:v2]\nab", [{ col: 4, row: 2 }], true)).toBe(
      "[inteligir:grid:v2]\nab\n\n....#",
    );
  });

  it("ignores off-grid cells rather than clamping them", () => {
    expect(paintCanvasCells(base, [{ col: 120, row: 0 }], true)).toBe(base);
    expect(paintCanvasCells(base, [{ col: 0, row: 60 }], true)).toBe(base);
    expect(paintCanvasCells(base, [{ col: -1, row: 0 }], true)).toBe(base);
  });

  it("leaves a headerless payload for the raw editor", () => {
    expect(paintCanvasCells("not a grid", [{ col: 0, row: 0 }], true)).toBe("not a grid");
  });
});

describe("clearCanvasGrid", () => {
  it("drops rows, keeps header and labels verbatim", () => {
    expect(clearCanvasGrid("[inteligir:grid:v2]\n[inteligir:labels:[]]\n##\n##")).toBe(
      "[inteligir:grid:v2]\n[inteligir:labels:[]]",
    );
    expect(clearCanvasGrid("[inteligir:grid:v2]\n##")).toBe("[inteligir:grid:v2]");
  });
});

describe("strokeSegmentCells", () => {
  it("interpolates a fast diagonal with no gaps and no duplicates", () => {
    const cells = strokeSegmentCells({ col: 0, row: 0 }, { col: 3, row: 3 });
    expect(cells).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
      { col: 3, row: 3 },
    ]);
    expect(strokeSegmentCells({ col: 5, row: 5 }, { col: 5, row: 5 })).toEqual([
      { col: 5, row: 5 },
    ]);
  });
});

describe("untouched blocks stay byte-exact through the pipeline", () => {
  it("chart and canvas fences round-trip unchanged", () => {
    const md =
      '```inteligir-chart\n{"type":"bar","data":[{"label":"Mon","value":12}]}\n```\n\n```inteligir-canvas\n[inteligir:grid:v2]\nab.\n.x.\n```\n';
    expect(roundTrip(md)).toBe(md);
  });
});
