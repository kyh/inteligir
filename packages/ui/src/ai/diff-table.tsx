"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { createContext, useContext, useMemo } from "react";
import type {
  HTMLAttributes,
  ReactNode,
  RefAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/cn";

export type DiffChange = "removed" | "added" | "unchanged";

interface DiffRowContextValue {
  change: DiffChange;
  included: boolean;
}

const DiffRowContext = createContext<DiffRowContextValue>({
  change: "unchanged",
  included: true,
});

const DiffTable = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="diff-table"
    className={cn(
      "relative w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
      className,
    )}
    {...props}
  />
);
DiffTable.displayName = "DiffTable";

export interface DiffTableHeaderProps extends HTMLAttributes<HTMLDivElement> {
  hint?: ReactNode;
}

const DiffTableHeader = ({
  className,
  children,
  hint,
  ref,
  ...props
}: DiffTableHeaderProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="diff-table-header"
    className={cn(
      "flex items-center justify-between gap-2 border-b border-line px-3 py-2",
      className,
    )}
    {...props}
  >
    <span className="text-[12.5px] font-medium text-ink">{children}</span>
    {hint === undefined ? null : <span className="text-[11px] text-ink-3">{hint}</span>}
  </div>
);
DiffTableHeader.displayName = "DiffTableHeader";

export interface DiffTableGridProps extends HTMLAttributes<HTMLTableElement> {
  widths?: readonly string[];
}

const DiffTableGrid = ({
  className,
  children,
  widths,
  ref,
  ...props
}: DiffTableGridProps & RefAttributes<HTMLTableElement>) => (
  <table
    ref={ref}
    data-slot="diff-table-grid"
    className={cn("w-full table-fixed border-collapse text-left", className)}
    {...props}
  >
    {widths === undefined ? null : (
      <colgroup>
        {widths.map((width, index) => (
          <col key={`${width}-${String(index)}`} style={{ width }} />
        ))}
      </colgroup>
    )}
    {children}
  </table>
);
DiffTableGrid.displayName = "DiffTableGrid";

const DiffTableHead = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLTableSectionElement> & RefAttributes<HTMLTableSectionElement>) => (
  <thead ref={ref} data-slot="diff-table-head" className={className} {...props}>
    <tr className="border-b border-line">{children}</tr>
  </thead>
);
DiffTableHead.displayName = "DiffTableHead";

const DiffTableHeadCell = ({
  className,
  ref,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & RefAttributes<HTMLTableCellElement>) => (
  <th
    ref={ref}
    data-slot="diff-table-head-cell"
    className={cn("px-3 py-2 text-[12px] font-medium text-ink-3", className)}
    {...props}
  />
);
DiffTableHeadCell.displayName = "DiffTableHeadCell";

const DiffTableBody = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLTableSectionElement> & RefAttributes<HTMLTableSectionElement>) => (
  <tbody ref={ref} data-slot="diff-table-body" className={className} {...props} />
);
DiffTableBody.displayName = "DiffTableBody";

export interface DiffRowProps extends HTMLAttributes<HTMLTableRowElement> {
  change?: DiffChange;
  included?: boolean;
  onToggle?: () => void;
}

const DiffRow = ({
  className,
  children,
  change = "unchanged",
  included = true,
  onToggle,
  ref,
  ...props
}: DiffRowProps & RefAttributes<HTMLTableRowElement>) => {
  const rowContext = useMemo(() => ({ change, included }), [change, included]);
  const interactive = onToggle !== undefined && change !== "unchanged";
  const marked = change !== "unchanged" && included;
  return (
    <DiffRowContext.Provider value={rowContext}>
      <tr
        ref={ref}
        data-slot="diff-row"
        data-change={change}
        tabIndex={interactive ? 0 : undefined}
        aria-selected={change === "unchanged" ? undefined : included}
        onClick={interactive ? onToggle : undefined}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                onToggle();
              }
            : undefined
        }
        className={cn(
          "border-b border-line transition-colors duration-150 last:border-0",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-inset focus-visible:outline-none",
          interactive && "cursor-pointer",
          marked && change === "removed" && "bg-destructive/8",
          marked && change === "added" && "bg-emerald-500/8",
          className,
        )}
        {...props}
      >
        {children}
      </tr>
    </DiffRowContext.Provider>
  );
};
DiffRow.displayName = "DiffRow";

const diffCellVariants = cva("px-3 py-2 transition-colors duration-200", {
  defaultVariants: { tone: "plain" },
  variants: {
    tone: {
      plain: "text-[12.5px] text-ink-2",
      primary: "text-[13px] font-medium text-ink tabular-nums",
      secondary: "text-[12.5px] whitespace-nowrap text-ink-2",
    },
  },
});

export interface DiffCellProps
  extends TdHTMLAttributes<HTMLTableCellElement>, VariantProps<typeof diffCellVariants> {}

const DiffCell = ({
  className,
  tone,
  ref,
  ...props
}: DiffCellProps & RefAttributes<HTMLTableCellElement>) => {
  const { change, included } = useContext(DiffRowContext);
  const marked = change !== "unchanged" && included;
  return (
    <td
      ref={ref}
      data-slot="diff-cell"
      className={cn(
        diffCellVariants({ tone }),
        marked && change === "removed" && "text-destructive line-through decoration-destructive/50",
        marked && change === "added" && "text-emerald-600 dark:text-emerald-400",
        className,
      )}
      {...props}
    />
  );
};
DiffCell.displayName = "DiffCell";

const CHECK = (
  <svg
    aria-hidden
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const DiffIncludedMark = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => {
  const { change, included } = useContext(DiffRowContext);
  const markedClass =
    change === "added"
      ? "scale-100 bg-emerald-500 text-white"
      : "scale-100 bg-destructive text-destructive-foreground";
  return (
    <span
      ref={ref}
      aria-hidden
      data-slot="diff-included-mark"
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded-[5px]",
        "transition-[background-color,color,transform] duration-150",
        included ? markedClass : "scale-[0.92] bg-surface-inset text-ink-3 shadow-surface-1",
        className,
      )}
      {...props}
    >
      {included ? CHECK : null}
    </span>
  );
};
DiffIncludedMark.displayName = "DiffIncludedMark";

export interface DiffTableFooterProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
}

const DiffTableFooter = ({
  className,
  children,
  actions,
  ref,
  ...props
}: DiffTableFooterProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="diff-table-footer"
    className={cn(
      "flex items-center justify-between gap-3 border-t border-line px-3 py-2.5",
      className,
    )}
    {...props}
  >
    <span className="flex items-center gap-2 text-[12px] text-ink-2">{children}</span>
    {actions === undefined ? null : <span className="flex items-center gap-2">{actions}</span>}
  </div>
);
DiffTableFooter.displayName = "DiffTableFooter";

export {
  DiffTable,
  DiffTableHeader,
  DiffTableGrid,
  DiffTableHead,
  DiffTableHeadCell,
  DiffTableBody,
  DiffRow,
  DiffCell,
  DiffIncludedMark,
  DiffTableFooter,
  diffCellVariants,
};
