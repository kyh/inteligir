import { ElementApi, NodeApi, createSlatePlugin } from "platejs";
import type { Operation, SlateEditor } from "platejs";

import { FORMULA_PILL_KEY } from "@repo/editor/headless/dialect-node-keys";
import {
  isFormulaPill,
  pillEntries,
  unsettledPills,
} from "@repo/editor/headless/formulas/pill-nodes";
import { appliesOwnEdit } from "@repo/editor/headless/body/own-edit";

const touchesPill = (editor: SlateEditor, op: Operation) => {
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

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

type Unsettled = "own" | "other";

const settleDisplays = (editor: SlateEditor) => {
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

          unsettled = null;
        }

        normalizeNode(entry);
      },
    },
  };
});

export const InlineConstructsBaseKit = [formulaPillBasePlugin];
