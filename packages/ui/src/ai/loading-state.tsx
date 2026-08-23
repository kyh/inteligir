"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef, useEffect, useState, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   drive — square cells, chevron wavefront driving right;
 *           the 650ms cycle is shorter than the sweep, so
 *           two fronts are always in flight
 *   dots  — same wavefront, circular cells
 *   orbit — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and a live elapsed timer
 * in mono tabular figures.
 * ───────────────────────────────────────────────────────── */

/** One cell of the 3x3 grid. The id is the cell's own coordinates, so the
 *  React key is positional identity rather than a list index. */
interface Cell {
  id: string;
  /** null never lights: the pattern skips this cell. */
  delay: number | null;
}

function grid(delayFor: (row: number, column: number) => number | null): Cell[] {
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const column = i % 3;
    return { id: `r${String(row)}c${String(column)}`, delay: delayFor(row, column) };
  });
}

const CHEVRON_CELLS = grid((row, column) => (column + Math.abs(row - 1)) * 90);

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT_CELLS = grid((row, column) => {
  const step = ORBIT_ORDER.indexOf(row * 3 + column);
  return step === -1 ? null : step * 110;
});

type LoadingVariant = "drive" | "dots" | "orbit";

const PATTERNS = {
  drive: { cells: CHEVRON_CELLS, durationMs: 650, round: false },
  dots: { cells: CHEVRON_CELLS, durationMs: 650, round: true },
  orbit: { cells: ORBIT_CELLS, durationMs: 950, round: false },
} satisfies Record<LoadingVariant, { cells: Cell[]; durationMs: number; round: boolean }>;

function LoaderGrid({ variant }: { variant: LoadingVariant }) {
  const { cells, durationMs, round } = PATTERNS[variant];
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {cells.map(({ id, delay }) => (
        <span
          key={id}
          // A null delay is a cell the pattern never lights: it stays at the
          // dim rest opacity with no animation rather than pulsing off-beat.
          className={cn(
            "size-[4px] bg-ink opacity-[0.07]",
            round ? "rounded-full" : "rounded-[1px]",
            delay !== null && "bui-pixel opacity-[0.15]",
          )}
          style={
            delay === null
              ? undefined
              : {
                  animationDelay: `${String(delay)}ms`,
                  animationDuration: `${String(durationMs)}ms`,
                }
          }
        />
      ))}
    </span>
  );
}

/** Tenths of a second since `startedAt`, or since mount when it is absent. */
function useElapsedLabel(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, (now - (startedAt ?? mountedAt)) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${String(Math.floor(seconds / 60))}m ${(seconds % 60).toFixed(1)}s`;
}

/** The variant is a cva variant so consumers get the union for free; the
 *  pattern table below is keyed by the same names. */
const loadingStateVariants = cva("flex w-fit items-center gap-2.5", {
  variants: {
    variant: {
      drive: "",
      dots: "",
      orbit: "",
    },
  },
  defaultVariants: { variant: "drive" },
});

export interface LoadingStateProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof loadingStateVariants> {
  /** What is being waited on — "Thinking", "Reading the vault", … */
  label: string;
  /**
   * Epoch ms the work began. Elapsed counts from HERE rather than from mount,
   * so a panel opened onto an already-running turn shows its real age.
   */
  startedAt?: number;
  /** Hide the timer where the surface already shows one. */
  showElapsed?: boolean;
}

const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ label, variant, startedAt, showElapsed = true, className, ...props }, ref) => {
    const elapsed = useElapsedLabel(startedAt);
    return (
      <div
        ref={ref}
        role="status"
        data-slot="loading-state"
        className={cn(loadingStateVariants({ variant }), className)}
        {...props}
      >
        <LoaderGrid variant={variant ?? "drive"} />
        <span className="bui-shimmer-text text-[13px] font-medium">{label}</span>
        {showElapsed ? (
          <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
        ) : null}
      </div>
    );
  },
);
LoadingState.displayName = "LoadingState";

export { LoadingState, loadingStateVariants };
