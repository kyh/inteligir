// a markdown file's frontmatter as the editor holds it: one node at the top, its yaml as written,
// which a formula reads its note's id from (`../formulas/formula-recompute.ts`).

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
