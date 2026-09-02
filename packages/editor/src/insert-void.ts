// Slate leaves the caret inside an inserted void's empty text child even with
// select:true, where every later keystroke lands in hidden text and never serializes.

import { KEYS, PathApi, type SlateEditor, type TElement } from "platejs";

export function insertVoidAndEscape(editor: SlateEditor, node: TElement): void {
  editor.tf.insertNodes(node);
  const voidEntry = editor.api.void();
  if (!voidEntry) return;
  const after = editor.api.after(voidEntry[1]);
  if (after) {
    editor.tf.select(after);
    return;
  }
  if (!editor.api.isInline(voidEntry[0])) {
    editor.tf.insertNodes(
      { children: [{ text: "" }], type: editor.getType(KEYS.p) },
      { at: PathApi.next(voidEntry[1]), select: true },
    );
  }
}
