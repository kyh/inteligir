import { KEYS, PathApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";

export const insertVoidAndEscape = (editor: SlateEditor, node: TElement, at?: Path) => {
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
