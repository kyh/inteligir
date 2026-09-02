// the mdast narrowing boundary: a walk asks here what a node is rather than discriminating
// structurally at each visit.

import type { Node, Root } from "mdast";
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx";
import { z } from "zod";

// unified types a transform's input as a bare `Node` when no plugin refined the generics.
export function isMdastRoot(node: Node): node is Root {
  return node.type === "root";
}

// a braced expression, a spread or a bare boolean do not survive Plate's attribute↔prop conversion.
export type LiteralAttribute = MdxJsxAttribute & { value: string };

const literalAttributeValue = z.string();

export function isLiteralAttribute(
  attribute: MdxJsxAttribute | MdxJsxExpressionAttribute,
): attribute is LiteralAttribute {
  return (
    attribute.type === "mdxJsxAttribute" && literalAttributeValue.safeParse(attribute.value).success
  );
}
