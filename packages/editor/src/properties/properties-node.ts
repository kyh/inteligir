// the panel edits the frontmatter node and Plate's serialize → onChange → editNote path
// persists it; there is no second write path to the file.

import { ElementApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import { stringProp } from "@repo/editor/node-props";

export const readFrontmatterRaw = (editor: SlateEditor): string | null => {
  const [first] = editor.children;
  if (ElementApi.isElement(first) && first.type === "frontmatter") {
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
  const node: TElement = { children: [{ text: "" }], type: "frontmatter", value: raw };
  editor.tf.insertNodes(node, { at: [0], select: false });
};
