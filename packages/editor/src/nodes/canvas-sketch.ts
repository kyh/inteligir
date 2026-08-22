// Cell-wise edits over the moss-canvas text grid. A stroke rewrites ONLY the
// cells it touched: untouched cells keep their exact original characters
// (existing payloads draw with arbitrary ink glyphs), the header and the
// labels line pass through verbatim, and short rows are padded with `.` only
// as far as a painted cell requires. `#` is the ink the vendored skill's own
// example writes.

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
  if (lines[0]?.trim() !== "[moss:grid:v2]") return null;
  const hasLabels = lines[1]?.startsWith("[moss:labels:") === true;
  const gridStart = hasLabels ? 2 : 1;
  return { head: lines.slice(0, gridStart), rows: lines.slice(gridStart) };
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
