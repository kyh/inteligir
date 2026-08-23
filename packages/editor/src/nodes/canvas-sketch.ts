// Cell-wise edits over the canvas text grid. A stroke rewrites ONLY the
// cells it touched: untouched cells keep their exact original characters
// (existing payloads draw with arbitrary ink glyphs), the header and the
// labels line pass through verbatim, and short rows are padded with `.` only
// as far as a painted cell requires. `#` is the ink the vendored skill's own
// example writes.

import {
  GRID_HEADER,
  isGridHeader,
  LABELS_PREFIX,
  labelLinePrefix,
} from "@repo/editor/nodes/canvas-header";

export const CANVAS_COLS = 120;
export const CANVAS_ROWS = 60;

export interface CanvasCell {
  col: number;
  row: number;
}

interface SplitPayload {
  head: string[];
  rows: string[];
}

function splitPayload(value: string): SplitPayload | null {
  const lines = value.split("\n");
  if (!isGridHeader(lines[0])) return null;
  const labelPrefix = labelLinePrefix(lines[1]);
  const gridStart = labelPrefix === null ? 1 : 2;
  // The head is rewritten through the shared constants. Serialization keeps a
  // rich block's payload verbatim.
  const labelLine = lines[1];
  const head =
    labelPrefix === null || labelLine === undefined
      ? [GRID_HEADER]
      : [GRID_HEADER, LABELS_PREFIX + labelLine.slice(labelPrefix.length)];
  return { head, rows: lines.slice(gridStart) };
}

/**
 * Paint `cells` as ink (`#`) or empty (`.`). Off-grid cells are ignored, not
 * clamped — clamping would ink a border cell the pointer never touched.
 * Answers the input unchanged when the payload has no v2 header (the raw
 * editor owns that case) or no cell survives the bounds check.
 */
export function paintCanvasCells(
  value: string,
  cells: readonly CanvasCell[],
  ink: boolean,
): string {
  const split = splitPayload(value);
  if (split === null) return value;
  const inBounds = cells.filter(
    (cell) =>
      cell.col >= 0 &&
      cell.col < CANVAS_COLS &&
      cell.row >= 0 &&
      cell.row < CANVAS_ROWS &&
      Number.isInteger(cell.col) &&
      Number.isInteger(cell.row),
  );
  if (inBounds.length === 0) return value;
  const rows = [...split.rows];
  for (const cell of inBounds) {
    while (rows.length <= cell.row) rows.push("");
    const row = rows[cell.row] ?? "";
    const padded = row.length <= cell.col ? row + ".".repeat(cell.col - row.length + 1) : row;
    rows[cell.row] = padded.slice(0, cell.col) + (ink ? "#" : ".") + padded.slice(cell.col + 1);
  }
  return [...split.head, ...rows].join("\n");
}

/** Drop every grid row; the header and labels line survive. */
export function clearCanvasGrid(value: string): string {
  const split = splitPayload(value);
  if (split === null) return value;
  return split.head.join("\n");
}

/**
 * The cells a pointer segment covers, linearly interpolated so a fast stroke
 * has no gaps. Both endpoints included; duplicates folded.
 */
export function strokeSegmentCells(from: CanvasCell, to: CanvasCell): CanvasCell[] {
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  const seen = new Set<string>();
  const cells: CanvasCell[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const col = Math.round(from.col + (to.col - from.col) * t);
    const row = Math.round(from.row + (to.row - from.row) * t);
    const key = `${String(col)},${String(row)}`;
    if (!seen.has(key)) {
      seen.add(key);
      cells.push({ col, row });
    }
  }
  return cells;
}
