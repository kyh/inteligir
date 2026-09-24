"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useEffect, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

interface Cell {
  id: string;
  /** null never lights: the pattern skips this cell. */
  delay: number | null;
}

const grid = (delayFor: (row: number, column: number) => number | null): Cell[] =>
  Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const column = i % 3;
    return { delay: delayFor(row, column), id: `r${String(row)}c${String(column)}` };
  });

const CHEVRON_CELLS = grid((row, column) => (column + Math.abs(row - 1)) * 90);

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT_CELLS = grid((row, column) => {
  const step = ORBIT_ORDER.indexOf(row * 3 + column);
  return step === -1 ? null : step * 110;
});

type LoadingVariant = "drive" | "dots" | "orbit";

const PATTERNS = {
  dots: { cells: CHEVRON_CELLS, durationMs: 650, round: true },
  drive: { cells: CHEVRON_CELLS, durationMs: 650, round: false },
  orbit: { cells: ORBIT_CELLS, durationMs: 950, round: false },
} satisfies Record<LoadingVariant, { cells: Cell[]; durationMs: number; round: boolean }>;

const LoaderGrid = ({ variant }: { variant: LoadingVariant }) => {
  const { cells, durationMs, round } = PATTERNS[variant];
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {cells.map(({ id, delay }) => (
        <span
          key={id}
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
};

const useElapsedLabel = (startedAt: number | undefined): string => {
  const [clock, setClock] = useState(() => {
    const mountedAt = Date.now();
    return { mountedAt, now: mountedAt };
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setClock((current) => ({ ...current, now: Date.now() }));
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const seconds = Math.max(0, (clock.now - (startedAt ?? clock.mountedAt)) / 1000);
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${String(Math.floor(seconds / 60))}m ${(seconds % 60).toFixed(1)}s`;
};

interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  variant?: LoadingVariant;
  startedAt?: number;
  showElapsed?: boolean;
}

const LoadingState = ({
  label,
  variant = "drive",
  startedAt,
  showElapsed = true,
  className,
  ref,
  ...props
}: LoadingStateProps & RefAttributes<HTMLDivElement>) => {
  const elapsed = useElapsedLabel(startedAt);
  return (
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the slot's ref and props are typed to HTMLDivElement
      role="status"
      data-slot="loading-state"
      className={cn("flex w-fit items-center gap-2.5", className)}
      {...props}
    >
      <LoaderGrid variant={variant} />
      <span className="bui-shimmer-text text-subtitle font-medium">{label}</span>
      {showElapsed ? (
        <span className="font-mono text-body text-ink-3 tabular-nums">{elapsed}</span>
      ) : null}
    </div>
  );
};
LoadingState.displayName = "LoadingState";

export { LoadingState };
