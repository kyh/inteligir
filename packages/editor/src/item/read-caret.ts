// slate-react reads a caret the person moved on a 100 ms throttle. A body laid in before that read
// transforms the selection read last, and when it moves the caret's block or the text before the
// caret, slate-react's next render writes that selection back over the page's, so a key pressed
// just before (End) is undone and what is typed next lands where the caret was. The caret is read
// off the page first, so the body moves the one the person sees.

import { RangeApi } from "platejs";
import type { SlateEditor } from "platejs";

export const readCaret = (editor: SlateEditor): void => {
  const editable = editor.api.toDOMNode(editor);
  // a field inside a block holds a caret of its own, and a composition owns the editor's
  if (
    editable === undefined ||
    editable.ownerDocument.activeElement !== editable ||
    editor.api.isComposing()
  ) {
    return;
  }
  const shown = editable.ownerDocument.getSelection();
  if (
    shown === null ||
    !editor.api.hasEditableTarget(shown.anchorNode) ||
    !editor.api.hasTarget(shown.focusNode)
  ) {
    return;
  }
  const caret = editor.api.toSlateRange(shown, { exactMatch: false, suppressThrow: true });
  if (caret && (editor.selection === null || !RangeApi.equals(caret, editor.selection))) {
    editor.tf.select(caret);
  }
};
