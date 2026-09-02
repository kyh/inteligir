// The one write path for a rich block's payload: an ordinary transaction, so the change rides
// serialize → save → git like typing.

import type { SlateEditor, TElement } from "platejs";

export function setBlockValue(editor: SlateEditor, element: TElement, value: string): void {
  const path = editor.api.findPath(element);
  if (path === undefined) return;
  editor.tf.setNodes({ value }, { at: path });
}
