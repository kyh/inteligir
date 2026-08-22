// The one write path for a rich Moss block's payload: a normal editor
// transaction over the node's `value`, so the change rides serialize → save →
// git exactly like typing. Nothing else may mutate these nodes.

import type { SlateEditor, TElement } from "platejs";

export function setBlockValue(editor: SlateEditor, element: TElement, value: string): void {
  const path = editor.api.findPath(element);
  if (path === undefined) return;
  editor.tf.setNodes({ value }, { at: path });
}
