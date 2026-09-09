import { z } from "zod";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "cn";

import { stringProp } from "@repo/editor/node-props";

import { clearCanvasGrid, paintCanvasCells, strokeSegmentCells } from "./canvas-sketch";
import type { CanvasCell } from "./canvas-sketch";
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

export const parseCanvasPayload = (value: string): CanvasParse => {
  const lines = value.split("\n");
  const [headerLine, labelLine] = lines;
  if (!isGridHeader(headerLine)) {
    return { ok: false, reason: `The payload does not begin with ${GRID_HEADER}.` };
  }
  let rowStart = 1;
  let labels: z.infer<typeof labelSchema>[] = [];
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
};

const usedRowsOf = (grid: boolean[][], labels: z.infer<typeof labelSchema>[]): number =>
  // crop to used rows so a small sketch is not a sea of empty grid; columns stay full width for stable label geometry.
  Math.max(8, grid.length, ...labels.map((label) => label.row + 2));

const CanvasSvg = ({
  grid,
  labels,
}: {
  grid: boolean[][];
  labels: z.infer<typeof labelSchema>[];
}) => {
  const usedRows = usedRowsOf(grid, labels);
  return (
    <svg
      viewBox={`0 0 ${String(COLS * CELL)} ${String(usedRows * CELL)}`}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline <svg> cannot be an <img>; role="img" is what makes AT read it as one named graphic.
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
};

type SketchTool = "pencil" | "eraser";

// the stroke commits once on pointer-up: one transaction, one undo step.
const SketchSurface = ({
  grid,
  labels,
  onStroke,
  tool,
}: {
  grid: boolean[][];
  labels: z.infer<typeof labelSchema>[];
  onStroke: (cells: CanvasCell[], ink: boolean) => void;
  tool: SketchTool;
}) => {
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
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline <svg> cannot be an <img>; role="img" is what makes AT read it as one named graphic.
      role="img"
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
      "rounded-sm px-1.5 py-0.5 text-xs",
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
    )}
    onClick={onClick}
  >
    {label}
  </button>
);

type CanvasMode = "view" | "sketch" | "raw";

const CanvasActions = ({
  canSketch,
  mode,
  onMode,
}: {
  canSketch: boolean;
  mode: CanvasMode;
  onMode: (mode: CanvasMode) => void;
}) => {
  if (mode === "sketch") {
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          onMode("view");
        }}
      >
        Done
      </button>
    );
  }
  if (mode !== "view") {
    return null;
  }
  return (
    <span className="flex items-center gap-1">
      {canSketch ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            onMode("sketch");
          }}
        >
          Sketch
        </button>
      ) : null}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          onMode("raw");
        }}
      >
        Edit payload
      </button>
    </span>
  );
};

const CanvasBody = ({
  mode,
  onMode,
  onStroke,
  onTool,
  onValue,
  parsed,
  tool,
  value,
}: {
  mode: CanvasMode;
  onMode: (mode: CanvasMode) => void;
  onStroke: (cells: CanvasCell[], ink: boolean) => void;
  onTool: (tool: SketchTool) => void;
  onValue: (next: string) => void;
  parsed: CanvasParse;
  tool: SketchTool;
  value: string;
}) => {
  if (mode === "raw") {
    return (
      <PayloadEditor
        initial={value}
        validate={(next) => {
          const verdict = parseCanvasPayload(next);
          return verdict.ok ? null : verdict.reason;
        }}
        onCancel={() => {
          onMode("view");
        }}
        onSave={(next) => {
          onValue(next);
          onMode("view");
        }}
      />
    );
  }
  if (!parsed.ok) {
    return <DegradedPayloadView reason={parsed.reason} value={value} />;
  }
  if (mode === "sketch") {
    return (
      <div className="px-2 py-1">
        <div className="flex items-center gap-1 pb-1">
          <SketchToolButton
            active={tool === "pencil"}
            label="Pencil"
            onClick={() => {
              onTool("pencil");
            }}
          />
          <SketchToolButton
            active={tool === "eraser"}
            label="Eraser"
            onClick={() => {
              onTool("eraser");
            }}
          />
          <span className="flex-1" />
          <SketchToolButton
            active={false}
            label="Clear"
            onClick={() => {
              onValue(clearCanvasGrid(value));
            }}
          />
        </div>
        <SketchSurface grid={parsed.grid} labels={parsed.labels} tool={tool} onStroke={onStroke} />
      </div>
    );
  }
  return (
    <div className="px-2 py-1">
      <CanvasSvg grid={parsed.grid} labels={parsed.labels} />
    </div>
  );
};

export const CanvasElement = (props: PlateElementProps) => {
  const [mode, setMode] = useState<CanvasMode>("view");
  const [tool, setTool] = useState<SketchTool>("pencil");
  const value = stringProp(props.element, "value") ?? "";
  const parsed = parseCanvasPayload(value);

  return (
    <PlateElement {...props}>
      <RichBlockCard
        label="canvas"
        actions={<CanvasActions canSketch={parsed.ok} mode={mode} onMode={setMode} />}
      >
        <CanvasBody
          mode={mode}
          parsed={parsed}
          tool={tool}
          value={value}
          onMode={setMode}
          onStroke={(cells, ink) => {
            setBlockValue(props.editor, props.element, paintCanvasCells(value, cells, ink));
          }}
          onTool={setTool}
          onValue={(next) => {
            setBlockValue(props.editor, props.element, next);
          }}
        />
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
};
