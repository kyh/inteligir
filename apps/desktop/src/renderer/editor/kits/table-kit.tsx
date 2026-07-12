// Table kit. Base half feeds the headless serialization mirror; the React
// half renders TableElement (with its per-table Base UI menu — independent of
// the block menu) from src/editor/nodes/table-node.tsx.

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

// The bordered grid itself lives in @repo/ui globals (`.typeset table` rules,
// shared by every typeset surface incl. chat); min-w is the editor-only
// affordance keeping empty cells clickable. Shared with the transclusion
// card's read-only static render (transclusion.tsx).
export const TABLE_CELL_CLASS = "min-w-24";
export const TABLE_HEADER_CELL_CLASS = "min-w-24";

export const TableKit = [
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(classNameElement("tr", "")),
  TableCellPlugin.withComponent(classNameElement("td", TABLE_CELL_CLASS)),
  TableCellHeaderPlugin.withComponent(classNameElement("th", TABLE_HEADER_CELL_CLASS)),
];
