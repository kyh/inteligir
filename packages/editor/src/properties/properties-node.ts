// the panel edits the frontmatter node and Plate's serialize → onChange → editNote path
// persists it; there is no second write path to the file.

import { ElementApi } from "platejs";
import type { SlateEditor, TElement, TNode } from "platejs";

import { FRONTMATTER_KEY } from "@repo/editor/dialect-node-keys";
import { stringProp } from "@repo/editor/node-props";

// the note's properties, edited through the properties panel: never a block a gesture takes.
export const isFrontmatterElement = (node: TNode | undefined): node is TElement =>
  ElementApi.isElement(node) && node.type === FRONTMATTER_KEY;

export const readFrontmatterRaw = (editor: SlateEditor): string | null => {
  const [first] = editor.children;
  if (isFrontmatterElement(first)) {
    return stringProp(first, "value") ?? "";
  }
  return null;
};

export const writeFrontmatterRaw = (editor: SlateEditor, raw: string): void => {
  const hasNode = readFrontmatterRaw(editor) !== null;
  if (raw === "") {
    if (hasNode) {
      editor.tf.removeNodes({ at: [0] });
    }
    return;
  }
  if (hasNode) {
    editor.tf.setNodes({ value: raw }, { at: [0] });
    return;
  }
  const node: TElement = { children: [{ text: "" }], type: FRONTMATTER_KEY, value: raw };
  editor.tf.insertNodes(node, { at: [0], select: false });
};
