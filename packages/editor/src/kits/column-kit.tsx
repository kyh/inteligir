// The plugins and their stable-width normalizer are headless (headless/column-base.ts).

import { KEYS, PathApi } from "platejs";
import type { PlateEditor } from "platejs/react";

import { ColumnElement, ColumnGroupElement } from "@repo/editor/nodes/column-node";

import { ColumnGroupBasePlugin, ColumnItemBasePlugin } from "./headless/column-base";

export const insertColumnGroup = (editor: PlateEditor, count: 2 | 3): void => {
  const emptyBlock = () => ({ children: [{ text: "" }], type: editor.getType(KEYS.p) });
  editor.tf.withoutNormalizing(() => {
    // select: true lands the caret in the last column; move it to the first.
    editor.tf.insertNodes(
      {
        children: Array.from({ length: count }, () => ({
          children: [emptyBlock()],
          type: editor.getType(KEYS.column),
        })),
        type: editor.getType(KEYS.columnGroup),
      },
      { select: true },
    );
    const column = editor.api.above({ match: { type: editor.getType(KEYS.column) } });
    if (!column) {
      return;
    }
    const start = editor.api.start([...PathApi.parent(column[1]), 0]);
    if (start) {
      editor.tf.select(start);
    }
  });
};

export const ColumnKit = [
  ColumnGroupBasePlugin.withComponent(ColumnGroupElement),
  ColumnItemBasePlugin.withComponent(ColumnElement),
];
