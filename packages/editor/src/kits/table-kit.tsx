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

import { classNameElement } from "@repo/editor/kits/kit-utils";
import { TableElement } from "@repo/editor/nodes/table-node";

export const TableBaseKit = [
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
];

// The grid is styled by `.typeset table` rules; min-w only keeps empty cells clickable.
export const TABLE_CELL_CLASS = "min-w-24";
export const TABLE_HEADER_CELL_CLASS = "min-w-24";

export const TableKit = [
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(classNameElement("tr", "")),
  TableCellPlugin.withComponent(classNameElement("td", TABLE_CELL_CLASS)),
  TableCellHeaderPlugin.withComponent(classNameElement("th", TABLE_HEADER_CELL_CLASS)),
];
