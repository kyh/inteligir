import { z } from "zod";
import type { PlateElementProps } from "platejs/react";
import { useRef, useState } from "react";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@repo/ui/lib/cn";

import { clearCanvasGrid, paintCanvasCells, strokeSegmentCells } from "./canvas-sketch";
import type { CanvasCell } from "./canvas-sketch";
import { RichBlock } from "./rich-block-chrome";
import type { Parse } from "./rich-block-chrome";
import {
  CANVAS_COLS,
  CANVAS_ROWS,
  GRID_HEADER,
  isGridHeader,
  isLabelsLine,
  LABELS_PREFIX,
} from "@repo/editor/nodes/canvas-header";

const CELL = 6;

const labelSchema = z.strictObject({
  col: z
    .number()
    .int()
    .min(0)
    .max(CANVAS_COLS - 1),
  id: z.string().min(1),
  row: z
    .number()
    .int()
    .min(0)
    .max(CANVAS_ROWS - 1),
  text: z.string().min(1),
});

interface CanvasPayload {
  grid: boolean[][];
  labels: z.infer<typeof labelSchema>[];
}

export const parseCanvasPayload = (value: string): Parse<CanvasPayload> => {
  const lines = value.split("\n");
  const [headerLine, labelLine] = lines;
  if (!isGridHeader(headerLine)) {
    return { ok: false, reason: `The payload does not begin with ${GRID_HEADER}.` };
  }
  let rowStart = 1;
  let labels: CanvasPayload["labels"] = [];
  if (isLabelsLine(labelLine)) {
    if (!labelLine.endsWith("]]")) {
      return { ok: false, reason: "The labels line does not close." };
    }
    const raw = labelLine.slice(LABELS_PREFIX.length, -1);
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
  const rows = lines.slice(rowStart, rowStart + CANVAS_ROWS);
  const grid = rows.map((row) =>
    Array.from({ length: Math.min(CANVAS_COLS, row.length) }, (_, col) => {
      const cell = row[col];
      return cell !== undefined && cell !== "." && cell !== " ";
    }),
  );
  return { ok: true, payload: { grid, labels } };
};

const usedRowsOf = ({ grid, labels }: CanvasPayload): number =>
  // crop to used rows so a small sketch is not a sea of empty grid; columns stay full width for stable label geometry.
  Math.max(8, grid.length, ...labels.map((label) => label.row + 2));

const cellKey = (col: number, row: number): string => `${String(col)},${String(row)}`;

// the one drawing of a canvas: its children are the sketch's stroke in progress, under the labels
const CanvasGrid = ({
  canvas,
  children,
  erased,
  rows,
  ...svg
}: ComponentProps<"svg"> & {
  canvas: CanvasPayload;
  rows: number;
  // the ink a stroke in progress rubs out
  erased?: ReadonlyMap<string, CanvasCell>;
}) => (
  <svg
    viewBox={`0 0 ${String(CANVAS_COLS * CELL)} ${String(rows * CELL)}`}
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline <svg> cannot be an <img>; role="img" is what makes AT read it as one named graphic.
    role="img"
    {...svg}
  >
    <defs>
      <pattern id="canvas-dots" width={CELL * 4} height={CELL * 4} patternUnits="userSpaceOnUse">
        <circle cx={1} cy={1} r={0.7} fill="var(--border)" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#canvas-dots)" />
    {canvas.grid.flatMap((row, rowIndex) =>
      row.flatMap((filled, colIndex) =>
        filled && erased?.has(cellKey(colIndex, rowIndex)) !== true
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
    {children}
    {canvas.labels.map((label) => (
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

type SketchTool = "pencil" | "eraser";

// the stroke commits once on pointer-up: one transaction, one undo step.
const SketchSurface = ({
  canvas,
  onStroke,
  tool,
}: {
  canvas: CanvasPayload;
  onStroke: (cells: CanvasCell[], ink: boolean) => void;
  tool: SketchTool;
}) => {
  const rowsShown = Math.min(CANVAS_ROWS, Math.max(24, usedRowsOf(canvas) + 6));
  const [pending, setPending] = useState<ReadonlyMap<string, CanvasCell>>(new Map());
  const lastCell = useRef<CanvasCell | null>(null);

  const cellAt = (event: ReactPointerEvent<SVGSVGElement>): CanvasCell => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      col: Math.floor(((event.clientX - rect.left) / rect.width) * CANVAS_COLS),
      row: Math.floor(((event.clientY - rect.top) / rect.height) * rowsShown),
    };
  };

  const extend = (to: CanvasCell): void => {
    const from = lastCell.current ?? to;
    lastCell.current = to;
    setPending((prior) => {
      const next = new Map(prior);
      for (const cell of strokeSegmentCells(from, to)) {
        next.set(cellKey(cell.col, cell.row), cell);
      }
      return next;
    });
  };

  const erasing = tool === "eraser";
  return (
    <CanvasGrid
      canvas={canvas}
      rows={rowsShown}
      erased={erasing ? pending : undefined}
      aria-label="canvas sketch surface"
      className={cn("w-full touch-none", erasing ? "cursor-cell" : "cursor-crosshair")}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        lastCell.current = null;
        extend(cellAt(event));
      }}
      onPointerMove={(event) => {
        if (lastCell.current !== null) {
          extend(cellAt(event));
        }
      }}
      onPointerUp={() => {
        if (pending.size > 0) {
          onStroke([...pending.values()], !erasing);
        }
        setPending(new Map());
        lastCell.current = null;
      }}
      onPointerCancel={() => {
        setPending(new Map());
        lastCell.current = null;
      }}
    >
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
    </CanvasGrid>
  );
};

const SketchToolButton = ({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={cn(
      "rounded-sm px-1.5 py-0.5 text-body",
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
    )}
    onClick={onClick}
  >
    {label}
  </button>
);

const CanvasSketch = ({
  canvas,
  value,
  write,
}: {
  canvas: CanvasPayload;
  value: string;
  write: (next: string) => void;
}) => {
  const [tool, setTool] = useState<SketchTool>("pencil");
  return (
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
            write(clearCanvasGrid(value));
          }}
        />
      </div>
      <SketchSurface
        canvas={canvas}
        tool={tool}
        onStroke={(cells, ink) => {
          write(paintCanvasCells(value, cells, ink));
        }}
      />
    </div>
  );
};

export const CanvasElement = (props: PlateElementProps) => (
  <RichBlock
    {...props}
    label="canvas"
    parse={parseCanvasPayload}
    renderView={(canvas) => (
      <div className="px-2 py-1">
        <CanvasGrid
          canvas={canvas}
          rows={usedRowsOf(canvas)}
          aria-label="canvas sketch"
          className="w-full"
        />
      </div>
    )}
    structured={{
      label: "Sketch",
      renderEditor: (canvas, write, value) => (
        <CanvasSketch canvas={canvas} value={value} write={write} />
      ),
    }}
  />
);
