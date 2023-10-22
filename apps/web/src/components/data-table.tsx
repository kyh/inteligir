"use client";

import { Fragment, useEffect, useState } from "react";
import type {
  ColumnDef,
  Row,
  Table as ReactTable,
  PaginationState,
  VisibilityState,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  getCoreRowModel,
  useReactTable,
  flexRender,
} from "@tanstack/react-table";
import {
  clx,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@inteligir/ui";
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

type ReactTableProps<T extends object> = {
  data: T[];
  columns: ColumnDef<T>[];
  renderSubComponent?: (props: { row: Row<T> }) => React.ReactElement;
  pageIndex?: number;
  pageSize?: number;
  pageCount?: number;
  onPaginationChange?: (pagination: PaginationState) => void;
  tableProps?: React.ComponentProps<typeof Table> &
    Record<`data-${string}`, string>;
};

const DataTable = <T extends object>({
  data,
  columns,
  renderSubComponent,
  pageIndex,
  pageSize,
  pageCount,
  onPaginationChange,
  tableProps,
}: ReactTableProps<T>) => {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: pageIndex ?? 0,
    pageSize: pageSize ?? 15,
  });

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    pageCount,
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    onPaginationChange: setPagination,
  });

  useEffect(() => {
    if (pagination.pageIndex === pageIndex) return;

    onPaginationChange?.(pagination);
  }, [onPaginationChange, pageIndex, pagination]);

  return (
    <div className="dark:border-dark-800 rounded-md border border-gray-50 p-1">
      <Table {...tableProps}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  colSpan={header.colSpan}
                  key={header.id}
                  style={{
                    width: header.column.getSize(),
                  }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                className={clx({
                  "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors":
                    row.getIsExpanded(),
                })}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{
                      width: cell.column.getSize(),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>

              {renderSubComponent ? (
                <TableRow key={`${row.id}-expanded`}>
                  <TableCell colSpan={columns.length}>
                    {renderSubComponent({ row })}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>

        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>
              <Pagination table={table} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};

const Pagination = <T,>({
  table,
}: React.PropsWithChildren<{
  table: ReactTable<T>;
}>) => (
  <div className="flex w-full items-center gap-2">
    <IconButton
      disabled={!table.getCanPreviousPage()}
      onClick={() => {
        table.setPageIndex(0);
      }}
    >
      <ChevronDoubleLeftIcon className="h-4" />
    </IconButton>

    <IconButton
      disabled={!table.getCanPreviousPage()}
      onClick={() => {
        table.previousPage();
      }}
    >
      <ChevronLeftIcon className="h-4" />
    </IconButton>

    <IconButton
      disabled={!table.getCanNextPage()}
      onClick={() => {
        table.nextPage();
      }}
    >
      <ChevronRightIcon className="h-4" />
    </IconButton>

    <IconButton
      disabled={!table.getCanNextPage()}
      onClick={() => {
        table.setPageIndex(table.getPageCount() - 1);
      }}
    >
      <ChevronDoubleRightIcon className="h-4" />
    </IconButton>

    <span className="flex items-center gap-1 text-sm">
      <div>Page</div>

      <div>
        {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
      </div>
    </span>
  </div>
);

export default DataTable;
