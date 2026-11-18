import { ElementApi } from "platejs";
import type { Descendant } from "platejs";

import { libraryNodeSchema, libraryTextSchema } from "@repo/contract/library/library-nodes";

export const schemaPairs = () => {
  const pairs = Object.keys(libraryTextSchema.shape)
    .filter((key) => key !== "text")
    .map((mark) => `mark:${mark}`);

  const [, elementSchema] = libraryNodeSchema.options;

  for (const element of elementSchema.options) {
    const fields = element.shape;
    const type = fields.type.value;
    pairs.push(`type:${type}`);

    for (const key of Object.keys(fields)) {
      if (key !== "type" && key !== "children") {
        pairs.push(`${type}.${key}`);
      }
    }
  }

  return pairs;
};

export const usedPairs = (nodes: readonly Descendant[], into: Set<string>) => {
  for (const node of nodes) {
    if (ElementApi.isElement(node)) {
      const { type } = node;
      into.add(`type:${type}`);

      for (const key of Object.keys(node)) {
        if (key !== "type" && key !== "children") {
          into.add(`${type}.${key}`);
        }
      }

      usedPairs(node.children, into);
    } else {
      for (const key of Object.keys(node)) {
        if (key !== "text") {
          into.add(`mark:${key}`);
        }
      }
    }
  }
};
