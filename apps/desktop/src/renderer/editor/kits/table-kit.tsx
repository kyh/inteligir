// Table kit. Base half feeds the headless serialization mirror; the React
// half renders TableElement (with its per-table Base UI menu — independent of
// WP3's block menu) from src/editor/nodes/table-node.tsx.

import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
} from "@platejs/table";
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { TableElement } from "@renderer/editor/nodes/table-node";

export const TableBaseKit = [
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
];

function element(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };
}

// Cell styling shared with the transclusion card's read-only static render
// (transclusion.tsx) so live tables and embedded tables can't drift apart.
export const TABLE_CELL_CLASS = "min-w-24 border border-border px-3 py-1.5 align-top [&>*]:my-0";
export const TABLE_HEADER_CELL_CLASS =
  "min-w-24 border border-border bg-muted px-3 py-1.5 text-left align-top font-semibold [&>*]:my-0";

export const TableKit = [
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(element("tr", "")),
  TableCellPlugin.withComponent(element("td", TABLE_CELL_CLASS)),
  TableCellHeaderPlugin.withComponent(element("th", TABLE_HEADER_CELL_CLASS)),
];
