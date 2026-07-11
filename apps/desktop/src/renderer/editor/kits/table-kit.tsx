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

import { classNameElement } from "@renderer/editor/kits/kit-utils";
import { TableElement } from "@renderer/editor/nodes/table-node";

export const TableBaseKit = [
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
];

// Bordered-grid cells (Kyh's call over typeset's docs-style row separators):
// the border/bg/padding utilities out-specify typeset's :where() table rules,
// while fonts and sizes still come from typeset. min-w keeps empty cells
// clickable while editing. Shared with the transclusion card's read-only
// static render (transclusion.tsx) so live and embedded tables can't drift.
export const TABLE_CELL_CLASS = "min-w-24 border border-border px-3 py-1.5 align-top [&>*]:my-0";
export const TABLE_HEADER_CELL_CLASS =
  "min-w-24 border border-border bg-muted px-3 py-1.5 text-left align-top font-semibold [&>*]:my-0";

export const TableKit = [
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(classNameElement("tr", "")),
  TableCellPlugin.withComponent(classNameElement("td", TABLE_CELL_CLASS)),
  TableCellHeaderPlugin.withComponent(classNameElement("th", TABLE_HEADER_CELL_CLASS)),
];
