// The rich-block payload parsers: the boundary where a fence's bytes become a
// render or a stated refusal. Shapes from the vendored skills' own examples.

import { describe, expect, it } from "vitest";

import { parseCanvasPayload } from "@repo/editor/nodes/canvas-node";
import { parseChartPayload } from "@repo/editor/nodes/chart-node";

describe("parseChartPayload", () => {
  it("accepts the skill's single-series example", () => {
    const verdict = parseChartPayload(
      '{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}',
    );
    expect(verdict.ok).toBe(true);
  });

  it("accepts the skill's multi-series example", () => {
    const verdict = parseChartPayload(
      '{"type":"line","series":[{"name":"Desktop","data":[{"label":"Mon","value":12}]},{"name":"Web","data":[{"label":"Mon","value":8}]}]}',
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses stacked-bar with series (the skill: one data array only)", () => {
    const verdict = parseChartPayload(
      '{"type":"stacked-bar","series":[{"name":"A","data":[{"label":"x","value":1}]}]}',
    );
    expect(verdict.ok).toBe(false);
  });

  it("refuses invalid JSON with a stated reason", () => {
    const verdict = parseChartPayload('{"type":"pie","data":not json');
    expect(verdict).toEqual({ ok: false, reason: "The payload is not valid JSON." });
  });

  it("refuses an unknown color name", () => {
    const verdict = parseChartPayload(
      '{"type":"bar","data":[{"label":"a","value":1,"color":"chartreuse"}]}',
    );
    expect(verdict.ok).toBe(false);
  });
});

describe("parseCanvasPayload", () => {
  it("accepts the skill's complete example", () => {
    const verdict = parseCanvasPayload(
      '[inteligir:grid:v2]\n[inteligir:labels:[{"id":"research","text":"Research","col":8,"row":4}]]\n....####\n....#..#\n....####',
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.labels[0]?.text).toBe("Research");
      expect(verdict.grid[0]?.[4]).toBe(true);
      expect(verdict.grid[0]?.[0]).toBe(false);
    }
  });

  it("accepts a labels-free grid", () => {
    expect(parseCanvasPayload("[inteligir:grid:v2]\n..##..").ok).toBe(true);
  });

  it("refuses a payload without the version header", () => {
    expect(parseCanvasPayload("..##..").ok).toBe(false);
  });

  it("refuses an off-grid label", () => {
    const verdict = parseCanvasPayload(
      '[inteligir:grid:v2]\n[inteligir:labels:[{"id":"x","text":"y","col":500,"row":0}]]\n.',
    );
    expect(verdict.ok).toBe(false);
  });
});
