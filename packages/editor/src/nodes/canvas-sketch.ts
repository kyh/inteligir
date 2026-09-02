// A stroke rewrites only the cells it touched: untouched cells keep their original glyphs
// (existing payloads use arbitrary ink), and rows are padded only as far as a painted cell requires.

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
  const labelLine = lines[1];
  const head =
    labelPrefix === null || labelLine === undefined
      ? [GRID_HEADER]
      : [GRID_HEADER, LABELS_PREFIX + labelLine.slice(labelPrefix.length)];
  return { head, rows: lines.slice(gridStart) };
}

// off-grid cells are ignored, not clamped: clamping would ink a border cell the pointer never touched.
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

export function clearCanvasGrid(value: string): string {
  const split = splitPayload(value);
  if (split === null) return value;
  return split.head.join("\n");
}

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
