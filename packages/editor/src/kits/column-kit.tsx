// Not @platejs/layout's plugins: its withColumn normalizer stamps width="33.333333333333336%"
// into every bare group on the first edit, breaking byte stability. Widths enter the document
// only through the resize commit in column-node.tsx.

import {
  ElementApi,
  KEYS,
  PathApi,
  createSlatePlugin,
  type OverrideEditor,
  type PluginConfig,
} from "platejs";
import type { PlateEditor } from "platejs/react";

import { ColumnElement, ColumnGroupElement } from "@repo/editor/nodes/column-node";

type ColumnConfig = PluginConfig<"column">;

const withStableColumns: OverrideEditor<ColumnConfig> = ({
  editor,
  tf: { normalizeNode, selectAll },
  type,
}) => ({
  transforms: {
    normalizeNode(entry) {
      const [node, path] = entry;
      if (ElementApi.isElement(node) && node.type === editor.getType(KEYS.columnGroup)) {
        const first = node.children[0];
        if (
          node.children.length === 1 &&
          ElementApi.isElement(first) &&
          first.type === editor.getType(KEYS.p)
        ) {
          editor.tf.unwrapNodes({ at: path });
          return;
        }
        if (!node.children.some((child) => ElementApi.isElement(child) && child.type === type)) {
          editor.tf.unwrapNodes({ at: path });
          return;
        }
        if (node.children.length < 2) {
          editor.tf.withoutNormalizing(() => {
            editor.tf.unwrapNodes({ at: path });
            editor.tf.unwrapNodes({ at: path });
          });
          return;
        }
      }
      if (ElementApi.isElement(node) && node.type === type && node.children.length === 0) {
        editor.tf.removeNodes({ at: path });
        return;
      }
      normalizeNode(entry);
    },
    selectAll: () => {
      const apply = (): boolean | undefined => {
        const at = editor.selection;
        if (!at) return;
        const column = editor.api.above({ match: { type } });
        if (!column) return;
        let targetPath = column[1];
        if (
          editor.api.isStart(editor.api.start(at), targetPath) &&
          editor.api.isEnd(editor.api.end(at), targetPath)
        ) {
          targetPath = PathApi.parent(targetPath);
        }
        if (targetPath.length === 0) return;
        editor.tf.select(targetPath);
        return true;
      };
      if (apply()) return true;
      return selectAll();
    },
  },
});

const ColumnItemBasePlugin = createSlatePlugin({
  key: KEYS.column,
  node: { isContainer: true, isElement: true, isStrictSiblings: true },
}).overrideEditor(withStableColumns);

const ColumnGroupBasePlugin = createSlatePlugin({
  key: KEYS.columnGroup,
  node: { isContainer: true, isElement: true },
});

export const ColumnBaseKit = [ColumnGroupBasePlugin, ColumnItemBasePlugin];

export function insertColumnGroup(editor: PlateEditor, count: 2 | 3): void {
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
    if (!column) return;
    const start = editor.api.start(PathApi.parent(column[1]).concat([0]));
    if (start) editor.tf.select(start);
  });
}

export const ColumnKit = [
  ColumnGroupBasePlugin.withComponent(ColumnGroupElement),
  ColumnItemBasePlugin.withComponent(ColumnElement),
];
