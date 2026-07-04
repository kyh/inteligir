// Post-parse vocabulary scan — mandatory before Rich mode. Unknown JSX
// deserializes to escaped TEXT whose alphanumeric content equals the source
// (probe1 "unknown JSX flow"), so the letters() heuristic alone would wave it
// into Rich mode and the first edit would mangle `<Foo>` into `\<Foo>` prose.
// The scan closes that hole: anything outside the fixed vocabulary → Raw.

import type { Nodes, Root } from "mdast";
// Import loads mdast-util-mdx's mdast declaration merging, so `Nodes` includes
// the mdx node types and the switch below narrows them.
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx";

export type RawReason =
  | { kind: "parse-error"; message: string; line: number | null }
  | { kind: "unknown-jsx"; name: string } // <Steps>, <div>, <kbd>, <> fragments
  | { kind: "jsx-attr"; name: string; attr: string } // non-string / bare / spread attr
  | { kind: "expression" } // {count}, {1+1} (agnostic expressions)
  | { kind: "esm" }; // unreachable under agnostic MDX; kept for safety

// The fixed vocabulary (this phase). Flow tags map to block nodes; `date` is
// the only inline (text) JSX element — but it is ALSO admitted in flow
// position: a paragraph holding nothing but a date chip serializes to
// `<date value="…" />` alone on its line, which micromark re-reads as a flow
// element (md-rules' date rule wraps it back into a paragraph). Everything
// else — headings, gfm, math, yaml, wikiLink/wikiEmbed — passes untouched.
// mdx-md disables htmlFlow/htmlText so no `html` nodes reach the scanner from
// parse.
const ALLOWED_FLOW_TAGS = new Set([
  "callout",
  "toggle",
  "column_group",
  "column",
  "video",
  "media_embed",
  "file",
  "date",
]);
const ALLOWED_TEXT_TAGS = new Set(["date"]);

// Plate's `date` rule keeps only `value` and DROPS every other attribute at
// deserialize — an unknown name on <date> would be silently deleted by the
// first rich save, so it must gate to Raw instead.
const DATE_ATTRS = new Set(["value"]);

// Every attribute on an allowed element must be a plain string-valued
// mdxJsxAttribute: bare booleans (`<callout draft>`) come back from Plate as
// `draft="null"`, braced expressions and spreads don't survive parseAttributes/
// propsToAttributes. Unknown attr NAMES are fine on the FLOW tags (their rules
// spread string props both directions, so they round-trip); `date` is the
// exception — see DATE_ATTRS.
function scanAttributes(
  tag: string,
  attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[],
): RawReason | null {
  for (const attr of attributes) {
    if (attr.type !== "mdxJsxAttribute") {
      return { attr: "{...spread}", kind: "jsx-attr", name: tag };
    }
    if (typeof attr.value !== "string") {
      return { attr: attr.name, kind: "jsx-attr", name: tag };
    }
    if (tag === "date" && !DATE_ATTRS.has(attr.name)) {
      return { attr: attr.name, kind: "jsx-attr", name: tag };
    }
  }
  return null;
}

function scanNode(node: Nodes): RawReason | null {
  switch (node.type) {
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement": {
      if (node.name === null) return { kind: "unknown-jsx", name: "<>" }; // fragment
      const allowed = node.type === "mdxJsxFlowElement" ? ALLOWED_FLOW_TAGS : ALLOWED_TEXT_TAGS;
      if (!allowed.has(node.name)) return { kind: "unknown-jsx", name: node.name };
      const bad = scanAttributes(node.name, node.attributes);
      if (bad) return bad;
      break;
    }
    case "mdxFlowExpression":
    case "mdxTextExpression":
      return { kind: "expression" };
    case "mdxjsEsm":
      return { kind: "esm" };
    default:
      break;
  }
  if ("children" in node) {
    for (const child of node.children) {
      const reason = scanNode(child);
      if (reason) return reason;
    }
  }
  return null;
}

/** First out-of-vocabulary construct in the tree, or null when Rich is safe. */
export function scanVocabulary(root: Root): RawReason | null {
  return scanNode(root);
}
