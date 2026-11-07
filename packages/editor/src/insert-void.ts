// Slate leaves the caret inside an inserted void's empty text child even with
// select:true, where every later keystroke lands in hidden text and never serializes.

import { KEYS, PathApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";

// the void inserted at the selection, or at `at`, with the caret moved past it; answers where the
// void landed, so a caller placing several in a row puts the next one after it
export const insertVoidAndEscape = (
  editor: SlateEditor,
  node: TElement,
  at?: Path,
): Path | null => {
  if (at === undefined) {
    editor.tf.insertNodes(node);
  } else {
    editor.tf.insertNodes(node, { at, select: true });
  }
  const voidEntry = editor.api.void();
  if (!voidEntry) {
    return null;
  }
  const after = editor.api.after(voidEntry[1]);
  if (after) {
    editor.tf.select(after);
    return voidEntry[1];
  }
  if (!editor.api.isInline(voidEntry[0])) {
    editor.tf.insertNodes(
      { children: [{ text: "" }], type: editor.getType(KEYS.p) },
      { at: PathApi.next(voidEntry[1]), select: true },
    );
  }
  return voidEntry[1];
};
