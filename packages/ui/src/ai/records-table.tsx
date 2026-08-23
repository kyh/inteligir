"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HTMLAttributes, PointerEvent, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * RECORDS TABLE — a grid of records whose columns an agent fills
 *
 * Upstream's file is the largest in the set, and most of it is the
 * DEMO: a company fixture, a competitor pool, model names, and the
 * enrichment sequence that walks them. None of that is a component
 * — it is one app's data and one app's pipeline — so it is not
 * carried. What IS carried is the grid: resizable columns, a
 * header that names each column's type and the tool behind it,
 * tag cells, and the trailing add-column affordance.
 *
 * Column widths live in context and are RESIZED IN PLACE by the
 * header's own handle, which is the interaction worth having: a
 * table of agent-filled columns is unreadable when one column of
 * prose crushes the rest.
 * ───────────────────────────────────────────────────────── */

interface RecordsTableContextValue {
  widths: Record<string, number>;
  setWidth: (column: string, width: number) => void;
}

const RecordsTableContext = createContext<RecordsTableContextValue>({
  widths: {},
  setWidth: () => undefined,
});

const MIN_COLUMN_WIDTH = 90;

export interface RecordsTableProps extends HTMLAttributes<HTMLDivElement> {
  /** Starting width per column key; resizing updates a local copy. */
  defaultWidths?: Record<string, number>;
  label?: string;
}

const RecordsTable = forwardRef<HTMLDivElement, RecordsTableProps>(
  ({ className, children, defaultWidths, label = "Records", ...props }, ref) => {
    const [widths, setWidths] = useState<Record<string, number>>(defaultWidths ?? {});
    const setWidth = useCallback((column: string, width: number) => {
      setWidths((current) => ({ ...current, [column]: Math.max(MIN_COLUMN_WIDTH, width) }));
    }, []);
    const tableContext = useMemo(() => ({ widths, setWidth }), [widths, setWidth]);

    return (
      <RecordsTableContext.Provider value={tableContext}>
        <div
          ref={ref}
          role="region"
          aria-label={label}
          tabIndex={0}
          data-slot="records-table"
          className={cn(
            "w-full overflow-x-auto rounded-xl bg-surface-raised shadow-surface-2",
            className,
          )}
          {...props}
        >
          <div className="min-w-max">{children}</div>
        </div>
      </RecordsTableContext.Provider>
    );
  },
);
RecordsTable.displayName = "RecordsTable";

const RecordsTableHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="row"
      data-slot="records-table-header"
      className={cn("flex items-stretch border-b border-line", className)}
      {...props}
    />
  ),
);
RecordsTableHeader.displayName = "RecordsTableHeader";

export interface RecordsColumnHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Key the width is stored under — also what a caller sorts by. */
  column: string;
  /** Glyph naming the column's type. */
  icon?: ReactNode;
  /** What fills this column — a model, a search, the user. */
  tool?: ReactNode;
  /** Omitted on the last column, where a handle has nothing to give. */
  resizable?: boolean;
}

const RecordsColumnHeader = forwardRef<HTMLDivElement, RecordsColumnHeaderProps>(
  ({ className, children, column, icon, tool, resizable = true, style, ...props }, ref) => {
    const { widths, setWidth } = useContext(RecordsTableContext);
    const [resizing, setResizing] = useState(false);
    const drag = useRef<{ x: number; width: number } | null>(null);
    const width = widths[column];

    const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
      if (event.target instanceof HTMLElement) event.target.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: width ?? MIN_COLUMN_WIDTH };
      setResizing(true);
    };
    const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
      const start = drag.current;
      if (start === null) return;
      setWidth(column, start.width + (event.clientX - start.x));
    };
    const stop = () => {
      drag.current = null;
      setResizing(false);
    };

    return (
      <div
        ref={ref}
        role="columnheader"
        data-slot="records-column-header"
        className={cn("relative flex shrink-0 flex-col justify-center px-3 py-2", className)}
        style={{ width, ...style }}
        {...props}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink [&_svg]:size-3.5 [&_svg]:text-ink-3">
          {icon}
          <span className="truncate">{children}</span>
        </span>
        {tool === undefined ? null : (
          <span className="mt-0.5 truncate text-[11px] text-ink-3">{tool}</span>
        )}
        {resizable ? (
          <span
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${column} column`}
            data-slot="records-resize-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
            className={cn(
              "absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none",
              "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-line",
              "hover:after:bg-line-strong",
              resizing && "after:bg-line-strong",
            )}
          />
        ) : null}
      </div>
    );
  },
);
RecordsColumnHeader.displayName = "RecordsColumnHeader";

const RecordsTableBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="records-table-body" className={className} {...props} />
  ),
);
RecordsTableBody.displayName = "RecordsTableBody";

const RecordsRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="row"
      data-slot="records-row"
      className={cn(
        "flex items-stretch border-b border-line transition-colors duration-100 last:border-0 hover:bg-hover",
        className,
      )}
      {...props}
    />
  ),
);
RecordsRow.displayName = "RecordsRow";

export interface RecordsCellProps extends HTMLAttributes<HTMLDivElement> {
  /** Matches a column header's key, so the two share one width. */
  column: string;
  /** True while an agent is still filling this cell. */
  pending?: boolean;
}

const RecordsCell = forwardRef<HTMLDivElement, RecordsCellProps>(
  ({ className, children, column, pending = false, style, ...props }, ref) => {
    const { widths } = useContext(RecordsTableContext);
    return (
      <div
        ref={ref}
        role="cell"
        data-slot="records-cell"
        className={cn(
          "flex shrink-0 items-center gap-1 px-3 py-2 text-[12.5px] text-ink-2",
          className,
        )}
        style={{ width: widths[column], ...style }}
        {...props}
      >
        {pending ? (
          <span
            aria-label="Filling"
            className="h-3 w-16 animate-pulse rounded-full bg-line motion-reduce:animate-none"
          />
        ) : (
          children
        )}
      </div>
    );
  },
);
RecordsCell.displayName = "RecordsCell";

const recordTagVariants = cva(
  "inline-flex h-5 max-w-full items-center rounded-md px-1.5 text-[11.5px] font-medium",
  {
    variants: {
      tone: {
        // Upstream carries a per-tag colour palette; this skin has none, so
        // tags separate from the cell by surface rather than by hue.
        neutral: "bg-surface-inset text-ink-2",
        strong: "bg-line text-ink",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface RecordTagProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof recordTagVariants> {}

const RecordTag = forwardRef<HTMLSpanElement, RecordTagProps>(
  ({ className, tone, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="record-tag"
      className={cn(recordTagVariants({ tone }), "truncate", className)}
      {...props}
    />
  ),
);
RecordTag.displayName = "RecordTag";

const RecordsAddColumn = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-slot="records-add-column"
      className={cn(
        "flex w-11 shrink-0 items-center justify-center text-ink-3",
        "transition-colors duration-100 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {children ?? (
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
    </button>
  ),
);
RecordsAddColumn.displayName = "RecordsAddColumn";

export {
  RecordsTable,
  RecordsTableHeader,
  RecordsColumnHeader,
  RecordsTableBody,
  RecordsRow,
  RecordsCell,
  RecordTag,
  RecordsAddColumn,
  recordTagVariants,
};
