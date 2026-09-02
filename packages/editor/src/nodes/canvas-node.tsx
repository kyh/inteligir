import { z } from "zod";
import { type PlateElementProps, PlateElement } from "platejs/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@repo/ui/lib/utils";

import { stringProp } from "@repo/editor/node-props";

import {
  type CanvasCell,
  clearCanvasGrid,
  paintCanvasCells,
  strokeSegmentCells,
} from "./canvas-sketch";
import { DegradedPayloadView, RichBlockCard, PayloadEditor } from "./rich-block-chrome";
import { setBlockValue } from "./rich-block-value";
import { GRID_HEADER, isGridHeader, labelLinePrefix } from "@repo/editor/nodes/canvas-header";

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
  if (!isGridHeader(lines[0])) {
    return { ok: false, reason: `The payload does not begin with ${GRID_HEADER}.` };
  }
  let rowStart = 1;
  let labels: z.infer<typeof labelSchema>[] = [];
  const labelLine = lines[1];
  const labelPrefix = labelLinePrefix(labelLine);
  if (labelLine !== undefined && labelPrefix !== null) {
    if (!labelLine.endsWith("]]")) {
      return { ok: false, reason: "The labels line does not close." };
    }
    const raw = labelLine.slice(labelPrefix.length, -1);
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

function usedRowsOf(grid: boolean[][], labels: z.infer<typeof labelSchema>[]): number {
  // crop to used rows so a small sketch is not a sea of empty grid; columns stay full width for stable label geometry.
  return Math.max(8, grid.length, ...labels.map((label) => label.row + 2));
}

function CanvasSvg({ grid, labels }: { grid: boolean[][]; labels: z.infer<typeof labelSchema>[] }) {
  const usedRows = usedRowsOf(grid, labels);
  return (
    <svg
      viewBox={`0 0 ${String(COLS * CELL)} ${String(usedRows * CELL)}`}
      role="img"
      aria-label="canvas sketch"
      className="w-full"
    >
      <defs>
        <pattern id="canvas-dots" width={CELL * 4} height={CELL * 4} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.7} fill="var(--border)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-dots)" />
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

type SketchTool = "pencil" | "eraser";

// the stroke commits once on pointer-up: one transaction, one undo step.
function SketchSurface({
  grid,
  labels,
  onStroke,
  tool,
}: {
  grid: boolean[][];
  labels: z.infer<typeof labelSchema>[];
  onStroke: (cells: CanvasCell[], ink: boolean) => void;
  tool: SketchTool;
}) {
  const rowsShown = Math.min(ROWS, Math.max(24, usedRowsOf(grid, labels) + 6));
  const [pending, setPending] = useState<ReadonlyMap<string, CanvasCell>>(new Map());
  const lastCell = useRef<CanvasCell | null>(null);

  const cellAt = (event: ReactPointerEvent<SVGSVGElement>): CanvasCell => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      col: Math.floor(((event.clientX - rect.left) / rect.width) * COLS),
      row: Math.floor(((event.clientY - rect.top) / rect.height) * rowsShown),
    };
  };

  const extend = (to: CanvasCell): void => {
    const from = lastCell.current ?? to;
    lastCell.current = to;
    setPending((prior) => {
      const next = new Map(prior);
      for (const cell of strokeSegmentCells(from, to)) {
        next.set(`${String(cell.col)},${String(cell.row)}`, cell);
      }
      return next;
    });
  };

  const erasing = tool === "eraser";
  return (
    <svg
      viewBox={`0 0 ${String(COLS * CELL)} ${String(rowsShown * CELL)}`}
      role="img"
      aria-label="canvas sketch surface"
      className={cn("w-full touch-none", erasing ? "cursor-cell" : "cursor-crosshair")}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        lastCell.current = null;
        extend(cellAt(event));
      }}
      onPointerMove={(event) => {
        if (lastCell.current !== null) extend(cellAt(event));
      }}
      onPointerUp={() => {
        if (pending.size > 0) onStroke([...pending.values()], !erasing);
        setPending(new Map());
        lastCell.current = null;
      }}
      onPointerCancel={() => {
        setPending(new Map());
        lastCell.current = null;
      }}
    >
      <defs>
        <pattern
          id="canvas-sketch-dots"
          width={CELL * 4}
          height={CELL * 4}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1} cy={1} r={0.7} fill="var(--border)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-sketch-dots)" />
      {grid.flatMap((row, rowIndex) =>
        row.flatMap((filled, colIndex) =>
          filled && !(erasing && pending.has(`${String(colIndex)},${String(rowIndex)}`))
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
      {erasing
        ? null
        : [...pending.values()].map((cell) => (
            <rect
              key={`p${String(cell.row)}-${String(cell.col)}`}
              x={cell.col * CELL}
              y={cell.row * CELL}
              width={CELL}
              height={CELL}
              fill="var(--foreground)"
              opacity={0.7}
            />
          ))}
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

function SketchToolButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-xs",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function CanvasElement(props: PlateElementProps) {
  const [mode, setMode] = useState<"view" | "sketch" | "raw">("view");
  const [tool, setTool] = useState<SketchTool>("pencil");
  const value = stringProp(props.element, "value") ?? "";
  const parsed = parseCanvasPayload(value);

  return (
    <PlateElement {...props}>
      <RichBlockCard
        label="canvas"
        actions={
          mode === "view" ? (
            <span className="flex items-center gap-1">
              {parsed.ok ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMode("sketch");
                  }}
                >
                  Sketch
                </button>
              ) : null}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMode("raw");
                }}
              >
                Edit payload
              </button>
            </span>
          ) : mode === "sketch" ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode("view");
              }}
            >
              Done
            </button>
          ) : null
        }
      >
        {mode === "raw" ? (
          <PayloadEditor
            initial={value}
            validate={(next) => {
              const verdict = parseCanvasPayload(next);
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
        ) : mode === "sketch" && parsed.ok ? (
          <div className="px-2 py-1">
            <div className="flex items-center gap-1 pb-1">
              <SketchToolButton
                active={tool === "pencil"}
                label="Pencil"
                onClick={() => {
                  setTool("pencil");
                }}
              />
              <SketchToolButton
                active={tool === "eraser"}
                label="Eraser"
                onClick={() => {
                  setTool("eraser");
                }}
              />
              <span className="flex-1" />
              <SketchToolButton
                active={false}
                label="Clear"
                onClick={() => {
                  setBlockValue(props.editor, props.element, clearCanvasGrid(value));
                }}
              />
            </div>
            <SketchSurface
              grid={parsed.grid}
              labels={parsed.labels}
              tool={tool}
              onStroke={(cells, ink) => {
                setBlockValue(props.editor, props.element, paintCanvasCells(value, cells, ink));
              }}
            />
          </div>
        ) : parsed.ok ? (
          <div className="px-2 py-1">
            <CanvasSvg grid={parsed.grid} labels={parsed.labels} />
          </div>
        ) : (
          <DegradedPayloadView reason={parsed.reason} value={value} />
        )}
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
}
