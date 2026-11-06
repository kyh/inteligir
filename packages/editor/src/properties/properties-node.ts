// a markdown file's frontmatter as the parse holds it: one node at the top, its yaml as written,
// which the serializer writes back as it came and no gesture takes.

import { ElementApi } from "platejs";
import type { TElement, TNode } from "platejs";

import { FRONTMATTER_KEY } from "@repo/editor/dialect-node-keys";

// the note's properties, edited through the properties panel: never a block a gesture takes.
export const isFrontmatterElement = (node: TNode | undefined): node is TElement =>
  ElementApi.isElement(node) && node.type === FRONTMATTER_KEY;
