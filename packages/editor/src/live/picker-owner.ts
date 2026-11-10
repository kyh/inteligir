// A picker's input stands in the shared document while it is open, so every device editing the
// note draws it; only the device that opened it takes its keys, or a picker opened elsewhere would
// pull the caret into its input here. The input names the document client that made it.

import { ElementApi, createSlatePlugin } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { YjsEditor } from "@slate-yjs/core";
import { PICKER_INPUT_TYPES } from "@repo/editor/combobox-input";
import { numberProp } from "@repo/editor/node-props";

import { appliesRemoteChange } from "./yjs-binding";

const OWNER_KEY = "owner";

// the document client this editor writes as; null for an editor bound to no document
const clientOf = (editor: SlateEditor): number | null =>
  YjsEditor.isYjsEditor(editor) ? (editor.sharedRoot.doc?.clientID ?? null) : null;

export const PickerOwnerPlugin = createSlatePlugin({ key: "pickerOwner" }).overrideEditor(
  ({ editor, tf: { apply } }) => ({
    transforms: {
      apply(op) {
        const client = clientOf(editor);
        if (
          client !== null &&
          op.type === "insert_node" &&
          ElementApi.isElement(op.node) &&
          PICKER_INPUT_TYPES.includes(op.node.type) &&
          !appliesRemoteChange(editor)
        ) {
          apply({ ...op, node: { ...op.node, [OWNER_KEY]: client } });
          return;
        }
        apply(op);
      },
    },
  }),
);

// whether this editor opened the picker: any editor bound to no document opened its own
export const ownsPicker = (editor: SlateEditor, element: TElement): boolean => {
  const client = clientOf(editor);
  return client === null || numberProp(element, OWNER_KEY) === client;
};
