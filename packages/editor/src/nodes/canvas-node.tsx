// moss-canvas: Moss's rough spatial surface, rendered READ-ONLY. The payload
// (vendored moss-canvas skill): line 1 `[moss:grid:v2]`, an optional
// single-line `[moss:labels:<JSON array>]`, then up to 60 grid rows of up to
// 120 chars where `.`/space are empty and anything else is ink. Sketch
// EDITING is deliberately out — this block presents cleanly and round-trips
// untouched; the raw-payload editor is the honest interim authoring surface.
// Legacy `moss-sketch` fences keep their name (the skill's own rule) and land
// here too.

import { z } from "zod";
import { type PlateElementProps, PlateElement } from "platejs/react";
import { useState } from "react";

import { DegradedPayloadView, MossBlockCard, PayloadEditor } from "./moss-block-chrome";
import { setBlockValue } from "./moss-block-value";

const COLS = 120;
const ROWS = 60;
const CELL = 6;

const labelSchema = z
  .object({
    col: z
      .number()
      .int()
      .min(0)
      .max(COLS - 1),
    id: z.string().min(1),
    row: z
      .number()
      .int()
      .min(0)
      .max(ROWS - 1),
    text: z.string().min(1),
  })
  .strict();

export type CanvasParse =
  | { ok: true; grid: boolean[][]; labels: z.infer<typeof labelSchema>[] }
  | { ok: false; reason: string };

export function parseCanvasPayload(value: string): CanvasParse {
  const lines = value.split("\n");
  if (lines[0]?.trim() !== "[moss:grid:v2]") {
    return { ok: false, reason: "The payload does not begin with [moss:grid:v2]." };
  }
  let rowStart = 1;
  let labels: z.infer<typeof labelSchema>[] = [];
  const labelLine = lines[1];
  if (labelLine !== undefined && labelLine.startsWith("[moss:labels:")) {
    if (!labelLine.endsWith("]]")) {
      return { ok: false, reason: "The labels line does not close." };
    }
    const raw = labelLine.slice("[moss:labels:".length, -1);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "The labels metadata is not valid JSON." };
    }
    const parsed = z.array(labelSchema).safeParse(json);
    if (!parsed.success) {
      return { ok: false, reason: "A label is missing id/text or sits off-grid." };
    }
    labels = parsed.data;
    rowStart = 2;
  }
  const rows = lines.slice(rowStart, rowStart + ROWS);
  const grid = rows.map((row) =>
    Array.from({ length: Math.min(COLS, row.length) }, (_, col) => {
      const cell = row[col];
      return cell !== undefined && cell !== "." && cell !== " ";
    }),
  );
  return { grid, labels, ok: true };
}

function CanvasSvg({ grid, labels }: { grid: boolean[][]; labels: z.infer<typeof labelSchema>[] }) {
  // The viewBox crops to used rows (plus margin) so a small sketch is not a
  // sea of empty grid; columns stay full-width for stable label geometry.
  const usedRows = Math.max(8, grid.length, ...labels.map((label) => label.row + 2));
  return (
    <svg
      viewBox={`0 0 ${String(COLS * CELL)} ${String(usedRows * CELL)}`}
      role="img"
      aria-label="canvas sketch"
      className="w-full"
    >
      <defs>
        <pattern
          id="moss-canvas-dots"
          width={CELL * 4}
          height={CELL * 4}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1} cy={1} r={0.7} fill="var(--border)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#moss-canvas-dots)" />
      {grid.flatMap((row, rowIndex) =>
        row.flatMap((filled, colIndex) =>
          filled
            ? [
                <rect
                  key={`${String(rowIndex)}-${String(colIndex)}`}
                  x={colIndex * CELL}
                  y={rowIndex * CELL}
                  width={CELL}
                  height={CELL}
                  fill="var(--muted-foreground)"
                  opacity={0.8}
                />,
              ]
            : [],
        ),
      )}
      {labels.map((label) => (
        <g
          key={label.id}
          transform={`translate(${String(label.col * CELL)}, ${String(label.row * CELL)})`}
        >
          <text fontSize={CELL * 1.8} dominantBaseline="hanging" className="fill-foreground">
            {label.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function CanvasElement(props: PlateElementProps) {
  const [editing, setEditing] = useState(false);
  const value = typeof props.element.value === "string" ? props.element.value : "";
  const parsed = parseCanvasPayload(value);

  return (
    <PlateElement {...props}>
      <MossBlockCard
        label="canvas"
        actions={
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit payload
          </button>
        }
      >
        {editing ? (
          <PayloadEditor
            initial={value}
            validate={(next) => {
              const verdict = parseCanvasPayload(next);
              return verdict.ok ? null : verdict.reason;
            }}
            onCancel={() => {
              setEditing(false);
            }}
            onSave={(next) => {
              setBlockValue(props.editor, props.element, next);
              setEditing(false);
            }}
          />
        ) : parsed.ok ? (
          <div className="px-2 py-1">
            <CanvasSvg grid={parsed.grid} labels={parsed.labels} />
          </div>
        ) : (
          <DegradedPayloadView reason={parsed.reason} value={value} />
        )}
      </MossBlockCard>
      {props.children}
    </PlateElement>
  );
}
