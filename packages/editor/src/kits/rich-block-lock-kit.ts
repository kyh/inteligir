import { ElementApi, KEYS, NodeApi, PathApi } from "platejs";
import type { Operation, Path, SlateEditor, TElement, TRange } from "platejs";
import { createPlatePlugin, useEditorRef, useReadOnly } from "platejs/react";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  HTML_BLOCK_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
} from "@repo/editor/headless/dialect-node-keys";
import { editGuard } from "@repo/editor/edit-guard";

const RICH_BLOCK_LOCK_KEY = "richBlockLock";

const RICH_BLOCK_INPUT_KEY = "richBlockInputLock";

export const lockedBlockTypes = (editor: SlateEditor) =>
  new Set([
    CHART_BLOCK_KEY,
    CANVAS_BLOCK_KEY,
    HTML_BLOCK_KEY,
    TAB_GROUP_KEY,
    TAB_PANEL_KEY,
    editor.getType(KEYS.columnGroup),
    editor.getType(KEYS.column),
  ]) satisfies ReadonlySet<string>;

const heldAt = (editor: SlateEditor, locked: ReadonlySet<string>, path: Path) => {
  for (let depth = 1; depth <= path.length; depth += 1) {
    const node = NodeApi.get(editor, path.slice(0, depth));

    if (ElementApi.isElement(node) && locked.has(node.type)) {
      return true;
    }
  }

  return false;
};

const heldAbove = (editor: SlateEditor, locked: ReadonlySet<string>, path: Path) =>
  path.length > 1 && heldAt(editor, locked, PathApi.parent(path));

const beforeRemovalOf = (removed: Path, path: Path) =>
  PathApi.equals(removed, path) ||
  PathApi.endsBefore(removed, path) ||
  PathApi.isAncestor(removed, path)
    ? path.map((index, depth) => (depth === removed.length - 1 ? index + 1 : index))
    : path;

const refuses = (editor: SlateEditor, locked: ReadonlySet<string>, op: Operation) => {
  switch (op.type) {
    case "insert_node":
    case "remove_node":
    case "insert_text":
    case "remove_text": {
      return heldAbove(editor, locked, op.path);
    }

    case "set_node":
    case "split_node": {
      return heldAt(editor, locked, op.path);
    }

    case "merge_node": {
      const previous = PathApi.previous(op.path);

      return (
        heldAt(editor, locked, op.path) ||
        (previous !== undefined && heldAt(editor, locked, previous))
      );
    }

    case "move_node": {
      return (
        heldAbove(editor, locked, op.path) ||
        (op.newPath.length > 1 &&
          heldAt(editor, locked, beforeRemovalOf(op.path, PathApi.parent(op.newPath))))
      );
    }

    case "set_selection": {
      return false;
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

const aimedRange = (editor: SlateEditor) => {
  const caret = window.getSelection();

  const mapped =
    caret === null || caret.rangeCount === 0
      ? null
      : editor.api.toSlateRange(caret, { exactMatch: false, suppressThrow: true });

  return mapped ?? editor.selection;
};

const edgeInsideLocked = (editor: SlateEditor, range: TRange) => {
  const locked = lockedBlockTypes(editor);

  return (
    heldAbove(editor, locked, range.anchor.path) || heldAbove(editor, locked, range.focus.path)
  );
};

const aimsInsideLocked = (editor: SlateEditor) => {
  const range = aimedRange(editor);

  return range !== null && edgeInsideLocked(editor, range);
};

const lockInstalled = (editor: SlateEditor) => Object.hasOwn(editor.plugins, RICH_BLOCK_LOCK_KEY);

export const RichBlockLockKit = [
  editGuard(RICH_BLOCK_LOCK_KEY, (editor) => {
    const locked = lockedBlockTypes(editor);

    return (op) => refuses(editor, locked, op);
  }),
  createPlatePlugin({
    editOnly: true,
    handlers: {
      onDOMBeforeInput: ({ editor, event }) => {
        if (!aimsInsideLocked(editor)) {
          return false;
        }

        event.preventDefault();

        return true;
      },
    },
    key: RICH_BLOCK_INPUT_KEY,
  }),
];

export const lockHolds = (editor: SlateEditor, node: TElement) => {
  const path = lockInstalled(editor) ? editor.api.findPath(node) : undefined;

  return path !== undefined && heldAt(editor, lockedBlockTypes(editor), path);
};

export const useRichBlocksLocked = () => {
  const editor = useEditorRef();

  return lockInstalled(editor);
};

export const useFrozen = () => {
  const readOnly = useReadOnly();

  return useRichBlocksLocked() || readOnly;
};
