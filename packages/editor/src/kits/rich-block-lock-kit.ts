// A touch surface shows the rich blocks it gives no way to edit: a chart's data, a sketch, an
// html payload, and what tabs and columns hold. The lock guards the model rather than the
// buttons, so no surface's edit reaches what such a block holds, while the block itself can
// still be inserted, removed or moved whole: a re-seed lands, and a deleted block comes back
// with one undo. An op it refuses never applies, so history never records it either.

import { ElementApi, KEYS, NodeApi, PathApi, createSlatePlugin } from "platejs";
import type { Operation, Path, SlateEditor, TRange } from "platejs";
import { createPlatePlugin, useEditorRef } from "platejs/react";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  HTML_BLOCK_KEY,
  TAB_GROUP_KEY,
  TAB_PANEL_KEY,
} from "@repo/editor/dialect-node-keys";

const RICH_BLOCK_LOCK_KEY = "richBlockLock";

const RICH_BLOCK_INPUT_KEY = "richBlockInputLock";

const lockedTypes = (editor: SlateEditor): ReadonlySet<string> =>
  new Set([
    CHART_BLOCK_KEY,
    CANVAS_BLOCK_KEY,
    HTML_BLOCK_KEY,
    TAB_GROUP_KEY,
    TAB_PANEL_KEY,
    editor.getType(KEYS.columnGroup),
    editor.getType(KEYS.column),
  ]);

// the node at `path`, or any element above it, is a locked block
const heldAt = (editor: SlateEditor, locked: ReadonlySet<string>, path: Path): boolean => {
  for (let depth = 1; depth <= path.length; depth += 1) {
    const node = NodeApi.get(editor, path.slice(0, depth));
    if (ElementApi.isElement(node) && locked.has(node.type)) {
      return true;
    }
  }
  return false;
};

const heldAbove = (editor: SlateEditor, locked: ReadonlySet<string>, path: Path): boolean =>
  path.length > 1 && heldAt(editor, locked, PathApi.parent(path));

// A move's `newPath` counts siblings after the node left its old spot, so a path it names sat one
// index further on wherever the moved node came before it (Slate's own insert_node rule).
const beforeRemovalOf = (removed: Path, path: Path): Path =>
  PathApi.equals(removed, path) ||
  PathApi.endsBefore(removed, path) ||
  PathApi.isAncestor(removed, path)
    ? path.map((index, depth) => (depth === removed.length - 1 ? index + 1 : index))
    : path;

const refuses = (editor: SlateEditor, locked: ReadonlySet<string>, op: Operation): boolean => {
  switch (op.type) {
    case "insert_node":
    case "remove_node":
    case "insert_text":
    case "remove_text": {
      return heldAbove(editor, locked, op.path);
    }
    // a void's payload is a prop on the void itself, so setting one is an edit of it
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
    // an exhaustive switch: falling off the end is what makes tsc reject a new op type
    // no default
  }
};

// Where a keystroke would land. slate-react takes the DOM caret as the selection only once the
// keystroke arrives, so the editor's own selection can still name where the caret was before a tap.
const aimedRange = (editor: SlateEditor): TRange | null => {
  const caret = window.getSelection();
  const mapped =
    caret === null || caret.rangeCount === 0
      ? null
      : editor.api.toSlateRange(caret, { exactMatch: false, suppressThrow: true });
  return mapped ?? editor.selection;
};

const aimsInsideLocked = (editor: SlateEditor): boolean => {
  const range = aimedRange(editor);
  if (range === null) {
    return false;
  }
  const locked = lockedTypes(editor);
  return (
    heldAbove(editor, locked, range.anchor.path) || heldAbove(editor, locked, range.focus.path)
  );
};

export const RichBlockLockKit = [
  createSlatePlugin({ key: RICH_BLOCK_LOCK_KEY }).overrideEditor(({ editor, tf: { apply } }) => {
    const locked = lockedTypes(editor);
    return {
      transforms: {
        apply(op) {
          if (refuses(editor, locked, op)) {
            return;
          }
          apply(op);
        },
      },
    };
  }),
  // A tap lands the DOM caret in a locked block's text, which is outside the editable, and
  // slate-react defers a plain character's insert to an input event the browser never fires
  // there; the deferred insert then lands wherever anyone types next. So a keystroke aimed inside
  // a locked block is refused before slate-react takes it.
  createPlatePlugin({
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

// the node renderers' switch: an editor built with the lock hides the controls it would refuse
export const useRichBlocksLocked = (): boolean => {
  const editor = useEditorRef();
  return Object.hasOwn(editor.plugins, RICH_BLOCK_LOCK_KEY);
};
