"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { createContext, forwardRef, useContext, useMemo } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "cn";

interface TableContextValue {
  columns: string;
}

const TableContext = createContext<TableContextValue>({ columns: "1fr" });

const FilterTable = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="filter-table" className={cn("w-full", className)} {...props} />
  ),
);
FilterTable.displayName = "FilterTable";

const FilterChips = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="filter-chips"
      className={cn(
        "-mx-1 mb-1 flex items-center gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  ),
);
FilterChips.displayName = "FilterChips";

export interface FilterChipProps extends HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: ReactNode;
  marker?: ReactNode;
}

const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ className, children, active = false, count, marker, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      data-slot="filter-chip"
      data-active={active ? "" : undefined}
      className={cn(
        "flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
        "transition-[background-color,box-shadow,color] duration-200",
        active ? "bg-surface-raised text-ink shadow-surface-1" : "text-ink-2 hover:bg-hover",
        className,
      )}
      {...props}
    >
      {marker}
      {children}
      {count === undefined ? null : (
        <span
          className={cn(
            "rounded-[4px] px-1 text-[10.5px] tabular-nums",
            active ? "bg-surface-inset text-ink-2" : "text-ink-3",
          )}
        >
          {count}
        </span>
      )}
    </button>
  ),
);
FilterChip.displayName = "FilterChip";

export interface DataTableProps extends HTMLAttributes<HTMLDivElement> {
  columns: string;
  minWidth?: number;
  label?: string;
}

const DataTable = forwardRef<HTMLDivElement, DataTableProps>(
  ({ className, children, columns, minWidth = 420, label = "Table", ...props }, ref) => (
    <TableContext.Provider value={useMemo(() => ({ columns }), [columns])}>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        data-slot="data-table"
        className={cn(
          "overflow-x-auto rounded-xl bg-surface-raised shadow-surface-2 [scrollbar-width:none]",
          className,
        )}
        {...props}
      >
        <div style={{ minWidth }}>{children}</div>
      </div>
    </TableContext.Provider>
  ),
);
DataTable.displayName = "DataTable";

const DataTableHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => {
    const { columns } = useContext(TableContext);
    return (
      <div
        ref={ref}
        data-slot="data-table-header"
        className={cn(
          "grid border-b border-line px-3 py-2 text-[11.5px] font-medium text-ink-3",
          className,
        )}
        style={{ gridTemplateColumns: columns, ...style }}
        {...props}
      />
    );
  },
);
DataTableHeader.displayName = "DataTableHeader";

export interface DataTableRowProps extends HTMLAttributes<HTMLDivElement> {
  visible?: boolean;
}

const DataTableRow = forwardRef<HTMLDivElement, DataTableRowProps>(
  ({ className, children, visible = true, style, ...props }, ref) => {
    const { columns } = useContext(TableContext);
    return (
      <Collapse open={visible}>
        <div
          ref={ref}
          data-slot="data-table-row"
          className={cn(
            "grid items-center border-b border-line px-3 py-2 text-[12px]",
            "transition-colors duration-100 last:border-0 hover:bg-hover",
            className,
          )}
          style={{ gridTemplateColumns: columns, ...style }}
          {...props}
        >
          {children}
        </div>
      </Collapse>
    );
  },
);
DataTableRow.displayName = "DataTableRow";

const dataTableCellVariants = cva("min-w-0", {
  variants: {
    tone: {
      primary: "truncate font-medium text-ink",
      secondary: "truncate text-ink-2",
      numeric: "text-ink-2 tabular-nums",
    },
  },
  defaultVariants: { tone: "secondary" },
});

export interface DataTableCellProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof dataTableCellVariants> {}

const DataTableCell = forwardRef<HTMLSpanElement, DataTableCellProps>(
  ({ className, tone, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="data-table-cell"
      className={cn(dataTableCellVariants({ tone }), className)}
      {...props}
    />
  ),
);
DataTableCell.displayName = "DataTableCell";

const statusPillVariants = cva(
  "inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-surface-inset text-ink-2",
        active: "bg-line text-ink",
        done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        failed: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface StatusPillProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusPillVariants> {}

const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, tone, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="status-pill"
      className={cn(statusPillVariants({ tone }), className)}
      {...props}
    />
  ),
);
StatusPill.displayName = "StatusPill";

export {
  FilterTable,
  FilterChips,
  FilterChip,
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableCell,
  StatusPill,
  dataTableCellVariants,
  statusPillVariants,
};
