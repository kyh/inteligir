import { ColumnElement, ColumnGroupElement } from "@repo/editor/nodes/column-node";

import {
  ColumnGroupBasePlugin,
  ColumnItemBasePlugin,
} from "@repo/editor/headless/kits/column-base";

export const ColumnKit = [
  ColumnGroupBasePlugin.withComponent(ColumnGroupElement),
  ColumnItemBasePlugin.withComponent(ColumnElement),
];
