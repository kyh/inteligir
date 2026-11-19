import { RangeApi } from "platejs";
import type { SlateEditor } from "platejs";

export const readCaret = (editor: SlateEditor) => {
  const editable = editor.api.toDOMNode(editor);

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
