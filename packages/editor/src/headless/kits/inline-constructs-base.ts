// A pill's display is derived where its source lands: every editor of a note, the note's own
// headless one among them, settles what its pills show inside the change that touched one, so no
// reader meets a display its sources do not give. Only an op on a pill asks for the pass, so
// typing walks nothing.

import { ElementApi, NodeApi, createSlatePlugin } from "platejs";
import type { Operation, SlateEditor } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/headless/dialect-node-keys";
import {
  isFormulaPill,
  pillEntries,
  unsettledPills,
} from "@repo/editor/headless/formulas/pill-nodes";
import { appliesOwnEdit } from "@repo/editor/headless/live/yjs-binding";

// whether the op can change what a pill shows: one set, added or removed, or moved, since the
// first pill to hold a name is the one read
const touchesPill = (editor: SlateEditor, op: Operation): boolean => {
  switch (op.type) {
    case "insert_node":
    case "remove_node": {
      return pillEntries([op.node]).length > 0;
    }
    case "set_node": {
      const node = NodeApi.get(editor, op.path);
      return node !== undefined && isFormulaPill(node);
    }
    case "move_node": {
      const node = NodeApi.get(editor, op.path);
      return ElementApi.isElement(node) && pillEntries([node]).length > 0;
    }
    case "insert_text":
    case "remove_text":
    case "merge_node":
    case "split_node":
    case "set_selection": {
      return false;
    }
    // an exhaustive switch: falling off the end is what makes tsc reject a new op type
    // no default
  }
};

// Whose op left the displays to settle. The person's own edit takes them along, in its one write
// and its one undo step. Anyone else's change, an undo among them, has them follow outside this
// editor's undo: on its stack they would be taken back and written again without end.
type Unsettled = "own" | "other";

const settleDisplays = (editor: SlateEditor): void => {
  for (const { at, display } of unsettledPills(editor.children)) {
    editor.tf.setNodes({ display }, { at });
  }
};

export const formulaPillBasePlugin = createSlatePlugin({
  key: FORMULA_PILL_KEY,
  node: { isElement: true, isInline: true, isVoid: true },
}).overrideEditor(({ editor, tf: { apply, normalizeNode } }) => {
  let unsettled: Unsettled | null = null;
  return {
    transforms: {
      apply(op) {
        if (touchesPill(editor, op)) {
          unsettled = unsettled === "own" || appliesOwnEdit(editor) ? "own" : "other";
        }
        apply(op);
      },
      normalizeNode(entry) {
        if (entry[1].length === 0 && unsettled !== null) {
          if (unsettled === "own") {
            settleDisplays(editor);
          } else {
            editor.tf.withoutSaving(() => {
              settleDisplays(editor);
            });
          }
          // a display reads no display, so the ones just written leave none to settle
          unsettled = null;
        }
        normalizeNode(entry);
      },
    },
  };
});

export const InlineConstructsBaseKit = [formulaPillBasePlugin];
