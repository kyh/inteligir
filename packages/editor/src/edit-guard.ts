import { createSlatePlugin } from "platejs";
import type { Operation, SlateEditor } from "platejs";

import { laysBody } from "@repo/editor/headless/body/lay-body";

export const editGuard = <K extends string>(
  key: K,
  guard: (editor: SlateEditor) => (op: Operation) => boolean,
) =>
  createSlatePlugin({ key }).overrideEditor(({ editor, tf: { apply, normalize } }) => {
    const refuses = guard(editor);
    let normalizing = 0;

    return {
      transforms: {
        apply(op) {
          if (normalizing === 0 && !laysBody(editor) && refuses(op)) {
            return;
          }

          apply(op);
        },
        normalize(options) {
          normalizing += 1;

          try {
            normalize(options);
          } finally {
            normalizing -= 1;
          }
        },
      },
    };
  });

export const editsLand = (editor: SlateEditor) => !editor.dom.readOnly;

export const ReadOnlyGuardPlugin = editGuard(
  "readOnlyGuard",
  (editor) => (op) => op.type !== "set_selection" && !editsLand(editor),
);
