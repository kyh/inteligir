// A guard over the model rather than the buttons: an op it refuses never applies, so history never
// records it, whichever surface asked. A body the library holds always lands (`laysBody`), and so
// does a normalizer's fix, since Slate's own normalizer loops forever on a fix that never lands.

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

// whether an edit made now lands: an editor shown read-only takes none
export const editsLand = (editor: SlateEditor): boolean => !editor.dom.readOnly;

// Plate's `readOnly` gates handlers and drawing, never a transform, so a node's own button would
// still write into a note that takes no edit. The caret still moves.
export const ReadOnlyGuardPlugin = editGuard(
  "readOnlyGuard",
  (editor) => (op) => op.type !== "set_selection" && !editsLand(editor),
);
