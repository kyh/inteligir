import * as React from "react";
import { cn } from "../lib/cn";
import { MinusIcon } from "../icons";
import { Button } from "./button";

const Root = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    className={cn("w-full text-xs text-ui-fg-subtle", className)}
    ref={ref}
    {...props}
  />
));
Root.displayName = "Table";

const Row = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    className={cn(
      "border-b border-ui-border-base bg-ui-bg-base transition-fg hover:bg-ui-bg-base-hover",
      "[&_td:last-child]:pr-8 [&_th:last-child]:pr-8",
      "[&_td:first-child]:pl-8 [&_th:first-child]:pl-8",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Row.displayName = "Table.Row";

const Cell = React.forwardRef<
  HTMLTableCellElement,
  React.HTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td className={cn("h-12 pr-3", className)} ref={ref} {...props} />
));
Cell.displayName = "Table.Cell";

const Header = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    className={cn(
      "&_tr:hover]:bg-ui-bg-base border-y border-ui-border-base text-xs font-medium",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Header.displayName = "Table.Header";

const HeaderCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th className={cn("h-12 pr-3 text-left", className)} ref={ref} {...props} />
));
HeaderCell.displayName = "Table.HeaderCell";

const Body = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    className={cn("border-b border-ui-border-base", className)}
    ref={ref}
    {...props}
  />
));
Body.displayName = "Table.Body";

type TablePaginationProps = {
  count: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  previousPage: () => void;
  nextPage: () => void;
} & React.HTMLAttributes<HTMLDivElement>;

const Pagination = React.forwardRef<HTMLDivElement, TablePaginationProps>(
  (
    {
      className,
      count,
      pageSize,
      pageCount,
      pageIndex,
      canPreviousPage,
      canNextPage,
      nextPage,
      previousPage,
      ...props
    },
    ref,
  ) => {
    const { from, to } = React.useMemo(() => {
      const f = count === 0 ? count : pageIndex * pageSize + 1;
      const t = Math.min(count, (pageIndex + 1) * pageSize);

      return { from: f, to: t };
    }, [count, pageIndex, pageSize]);

    return (
      <div
        className={cn(
          "flex w-full items-center justify-between px-5 pb-6 pt-4 text-xs font-medium text-ui-fg-subtle",
          className,
        )}
        ref={ref}
        {...props}
      >
        <div className="inline-flex items-center gap-x-1 px-3 py-[5px]">
          <p>{from}</p>
          <MinusIcon className="h-5 w-5 text-ui-fg-muted" />
          <p>{`${to} of ${count} results`}</p>
        </div>
        <div className="flex items-center gap-x-2">
          <div className="inline-flex items-center gap-x-1 px-3 py-[5px]">
            <p>
              {pageIndex + 1} of {Math.max(pageCount, 1)}
            </p>
          </div>
          <Button
            disabled={!canPreviousPage}
            onClick={previousPage}
            variant="transparent"
          >
            Prev
          </Button>
          <Button
            disabled={!canNextPage}
            onClick={nextPage}
            variant="transparent"
          >
            Next
          </Button>
        </div>
      </div>
    );
  },
);
Pagination.displayName = "Table.Pagination";

const Table = Object.assign(Root, {
  Row,
  Cell,
  Header,
  HeaderCell,
  Body,
  Pagination,
});

export { Table };
