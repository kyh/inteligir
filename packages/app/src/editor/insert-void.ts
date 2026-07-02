// Void-node insertion with caret escape. Slate leaves the caret INSIDE the
// inserted void's empty text child (with or without select:true), where every
// subsequent keystroke is swallowed — typed characters land in the void's
// hidden text and never serialize. Shared by the wiki `]]` completion and the
// date/equation/embed insert transforms.

import { KEYS, PathApi, type SlateEditor, type TElement } from "platejs";

/**
 * Insert `node` at the selection, then move the caret to the first point
 * AFTER it. A block void inserted at the end of the document gets an escape
 * paragraph appended so the caret always has somewhere to go.
 */
export function insertVoidAndEscape(editor: SlateEditor, node: TElement): void {
  editor.tf.insertNodes(node);
  const voidEntry = editor.api.void();
  if (!voidEntry) return; // caret already escaped
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
