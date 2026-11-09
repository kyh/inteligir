// Markdown read into the editor's value: what a read hands the codec is its elements, a root text
// having already refused the read (`@repo/editor/markdown/md-read`).

import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

export const elementsOf = (nodes: readonly Descendant[]): TElement[] =>
  nodes.filter((node): node is TElement => ElementApi.isElement(node));
