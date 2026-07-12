// Column kit. Node shapes (serialization contract):
//   { type: "column_group", children: column[] }
//   { type: "column", width?: string, children: Block[] }
// Canonical insert form is BARE `<column>` (no width until the first resize
// commit — locked decision).
//
// The plugins are OWNED here instead of using @platejs/layout's: its
// withColumn normalizer force-writes widths into every group whose widths
// don't sum to 100 — a bare group gets `width="33.333333333333336%"` stamped
// into the document on the first edit inside it, breaking byte-stability and
// the bare-insert decision. This re-derivation keeps the structural
// invariants (dissolve single-child/column-less groups, drop empty columns,
// column-scoped select-all) and REMOVES the sum-to-100 width writer: widths
// enter the document only through the resize commit (column-node.tsx,
// commit-on-release, ≤2 decimals). Serialization is untouched either way —
// the `<column_group>`/`<column width>` rules live in @platejs/markdown's
// defaults (fixtures column-widths/jsx-* pin both forms).

import {
  ElementApi,
  KEYS,
  PathApi,
  createSlatePlugin,
  type OverrideEditor,
  type PluginConfig,
} from "platejs";
import type { PlateEditor } from "platejs/react";

import { ColumnElement, ColumnGroupElement } from "@renderer/editor/nodes/column-node";

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
        // A group holding a single non-column block dissolves into it.
        if (
          node.children.length === 1 &&
          ElementApi.isElement(first) &&
          first.type === editor.getType(KEYS.p)
        ) {
          editor.tf.unwrapNodes({ at: path });
          return;
        }
        // No columns left → dissolve the group.
        if (!node.children.some((child) => ElementApi.isElement(child) && child.type === type)) {
          editor.tf.unwrapNodes({ at: path });
          return;
        }
        // One column left → dissolve both wrappers.
        if (node.children.length < 2) {
          editor.tf.withoutNormalizing(() => {
            editor.tf.unwrapNodes({ at: path });
            editor.tf.unwrapNodes({ at: path });
          });
          return;
        }
        // Deliberately NO sum-to-100 width write here (see header comment).
      }
      if (ElementApi.isElement(node) && node.type === type && node.children.length === 0) {
        editor.tf.removeNodes({ at: path });
        return;
      }
      normalizeNode(entry);
    },
    // Mod+A inside a column selects the column content first, then the group,
    // then the document (matches @platejs/layout's behavior).
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

/**
 * Insert a column group with `count` BARE columns (no `width` — equal widths
 * come from flex; the width attr appears only after the first resize commit).
 * Inserted from the slash menu's 2/3-column entries.
 */
export function insertColumnGroup(editor: PlateEditor, count: 2 | 3): void {
  const emptyBlock = () => ({ children: [{ text: "" }], type: editor.getType(KEYS.p) });
  editor.tf.withoutNormalizing(() => {
    // select: true drops the cursor inside the inserted group (last column);
    // walk up to the group and put the caret at the start of its first column.
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
