// The mdast union's membership tests, stated once — the named boundary a tree
// walk asks instead of re-deriving what a node is at every visit. mdast
// discriminates on `type`, so most of this file is that discriminant given a
// domain name; the one payload that arrives UNdiscriminated — an MDX
// attribute's literal-or-expression value — is decoded against a schema here
// rather than sniffed at each use.

import type { Node, Root } from "mdast";
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx";
import { z } from "zod";

/** The document root. unified types a transform's input/output as a bare
 * `Node` whenever no plugin refined the processor's generics, so both ends of
 * this pipeline have to say what they were handed. */
export function isMdastRoot(node: Node): node is Root {
  return node.type === "root";
}

/** An MDX attribute whose value is a plain string — `<callout kind="info">`.
 * The alternatives are a braced expression, a spread and a bare boolean, none
 * of which survive Plate's attribute↔prop conversion. */
export type LiteralAttribute = MdxJsxAttribute & { value: string };

const literalAttributeValue = z.string();

export function isLiteralAttribute(
  attribute: MdxJsxAttribute | MdxJsxExpressionAttribute,
): attribute is LiteralAttribute {
  return (
    attribute.type === "mdxJsxAttribute" && literalAttributeValue.safeParse(attribute.value).success
  );
}
