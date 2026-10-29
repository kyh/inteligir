"use client";
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a virtualized grid of rows positioned by transform, which <table> and <tr> cannot be */
// The one component that calls `useVirtualizer` (@tanstack/react-virtual), which the React
// Compiler skips as known-incompatible: the virtualizer is a mutable instance read during render.
// So the cells are children the compiler does compile, and only this file goes uncompiled
// (CLAUDE.md § THE CARD GRID IS VIRTUALIZED BY UNIFORM ROWS). Rows are uniform: every cell is
// `cellHeight(cellWidth)` tall, so nothing is measured, and a resize re-derives the columns and
// the row pitch from the width alone.

import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import type { Range, Virtualizer } from "@tanstack/react-virtual";
import { Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEventHandler, ReactNode, RefObject } from "react";

import { cn } from "@repo/ui/lib/cn";

export interface CardGridHandle {
  scrollToCell: (index: number) => void;
}

interface CardGridProps {
  count: number;
  minCellWidth: number;
  gap?: number;
  // uniform rows; nothing is measured
  cellHeight: (cellWidth: number) => number;
  renderCell: (index: number) => ReactNode;
  // the roving cell survives scroll, so focus never lands on an unmounted node
  keepMountedIndex?: number | null;
  initialOffset?: number;
  onScrollOffset?: (px: number) => void;
  onRangeChange?: (range: { first: number; last: number }) => void;
  onColumnsChange?: (columns: number) => void;
  // jsdom lays nothing out, so a suite names the box the grid would have
  initialRect?: { width: number; height: number };
  handleRef?: RefObject<CardGridHandle | null>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  className?: string;
  "aria-label": string;
  "aria-multiselectable"?: boolean;
}

const DEFAULT_GAP = 16;
// the inset the cells keep from the scroller's edges, on every side
const INSET = 16;
const OVERSCAN = 3;

interface Rect {
  width: number;
  height: number;
}

const gridColumns = (width: number, minCellWidth: number, gap: number): number =>
  Math.max(1, Math.floor((width + gap) / (minCellWidth + gap)));

// the scroller's content box, or the named one while it lays out as nothing
const observeRect =
  (fallback: Rect | undefined, onWidth: (width: number) => void) =>
  (instance: Virtualizer<HTMLDivElement, HTMLDivElement>, publish: (rect: Rect) => void) => {
    const element = instance.scrollElement;
    if (element === null) {
      return;
    }
    const report = (width: number, height: number): void => {
      const rect =
        fallback !== undefined && width === 0 && height === 0
          ? fallback
          : { height: Math.round(height), width: Math.round(width) };
      onWidth(rect.width);
      publish(rect);
    };
    report(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) {
        report(box.width, box.height);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  };

export const CardGrid = ({
  count,
  minCellWidth,
  gap = DEFAULT_GAP,
  cellHeight,
  renderCell,
  keepMountedIndex = null,
  initialOffset,
  onScrollOffset,
  onRangeChange,
  onColumnsChange,
  initialRect,
  handleRef,
  onKeyDown,
  className,
  "aria-label": ariaLabel,
  "aria-multiselectable": ariaMultiselectable,
}: CardGridProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialRect?.width ?? 0);
  const inner = Math.max(0, width - INSET * 2);
  const columns = gridColumns(inner, minCellWidth, gap);
  const cellWidth = Math.max(0, (inner - gap * (columns - 1)) / columns);
  const rowHeight = Math.max(1, Math.round(cellHeight(cellWidth)));
  const rowCount = Math.ceil(count / columns);
  const keepRow = keepMountedIndex === null ? null : Math.floor(keepMountedIndex / columns);

  const onScrollOffsetRef = useRef(onScrollOffset);
  useLayoutEffect(() => {
    onScrollOffsetRef.current = onScrollOffset;
  });

  // oxlint-disable-next-line react/incompatible-library -- the one component the compiler skips: the virtualizer is a mutable instance read in render, and the cells under it stay compiled (CLAUDE.md § THE CARD GRID IS VIRTUALIZED BY UNIFORM ROWS)
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    estimateSize: () => rowHeight,
    gap,
    getScrollElement: () => scrollerRef.current,
    initialOffset: initialOffset ?? 0,
    initialRect: initialRect ?? { height: 0, width: 0 },
    observeElementRect: observeRect(initialRect, setWidth),
    onChange: (instance) => {
      onScrollOffsetRef.current?.(instance.scrollOffset ?? 0);
    },
    overscan: OVERSCAN,
    paddingEnd: INSET,
    paddingStart: INSET,
    rangeExtractor: (range: Range) => {
      const rows = defaultRangeExtractor(range);
      if (keepRow === null || keepRow >= range.count || rows.includes(keepRow)) {
        return rows;
      }
      return [...rows, keepRow].toSorted((a, b) => a - b);
    },
    scrollPaddingEnd: INSET,
    scrollPaddingStart: INSET,
    useFlushSync: false,
  });

  // the row pitch moves with the width alone, and the virtualizer caches every size it handed
  // out, so a new pitch re-derives them all
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToCell: (index: number) => {
        virtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" });
      },
    }),
    [virtualizer, columns],
  );

  useEffect(() => {
    onColumnsChange?.(columns);
  }, [columns, onColumnsChange]);

  const { range } = virtualizer;
  const first = range === null ? 0 : range.startIndex * columns;
  const last = range === null ? -1 : Math.min(count - 1, (range.endIndex + 1) * columns - 1);
  useEffect(() => {
    if (last >= first) {
      onRangeChange?.({ first, last });
    }
  }, [first, last, onRangeChange]);

  return (
    <div
      ref={scrollerRef}
      role="grid"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-multiselectable={ariaMultiselectable}
      aria-rowcount={rowCount}
      aria-colcount={columns}
      onKeyDown={onKeyDown}
      data-slot="card-grid"
      className={cn("relative min-h-0 flex-1 overflow-y-auto outline-none", className)}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          const end = Math.min(count, start + columns);
          const cells: ReactNode[] = [];
          for (let index = start; index < end; index += 1) {
            cells.push(<Fragment key={index}>{renderCell(index)}</Fragment>);
          }
          return (
            <div
              key={row.key}
              role="row"
              aria-rowindex={row.index + 1}
              data-index={row.index}
              className="absolute top-0 grid"
              style={{
                columnGap: gap,
                gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
                height: rowHeight,
                left: INSET,
                right: INSET,
                transform: `translateY(${String(row.start)}px)`,
              }}
            >
              {cells}
            </div>
          );
        })}
      </div>
    </div>
  );
};
