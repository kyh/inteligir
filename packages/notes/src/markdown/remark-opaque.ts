// a construct the slate model has no node for is held as a string and serialized back
// verbatim; without one, unknown jsx deserializes to escaped text and the first save mangles
// `<Foo>` into `\<Foo>`. the value is re-serialized, not sliced from source: a slice inside a
// blockquote would capture the `> ` markers and the stringifier would add a second set.

import type { Node, Nodes } from "mdast";
import type {
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from "mdast-util-mdx";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { toMarkdown } from "mdast-util-to-markdown";

import { isLiteralAttribute, isMdastRoot } from "./mdast-nodes";

export interface OpaqueBlock extends Node {
  type: "opaqueBlock";
  value: string;
}
export interface OpaqueInline extends Node {
  type: "opaqueInline";
  value: string;
}

declare module "mdast" {
  interface BlockContentMap {
    opaqueBlock: OpaqueBlock;
  }
  interface PhrasingContentMap {
    opaqueInline: OpaqueInline;
  }
  interface RootContentMap {
    opaqueBlock: OpaqueBlock;
    opaqueInline: OpaqueInline;
  }
}

// `date` is the only inline element but is admitted in flow too: a paragraph holding only a
// date chip serializes to `<date value="…" />` alone on its line, which micromark re-reads as flow.
const COMPONENT_FLOW_TAGS = new Set([
  "callout",
  "toggle",
  "column_group",
  "column",
  "video",
  "media_embed",
  "file",
  "date",
]);
const COMPONENT_TEXT_TAGS = new Set(["date"]);

// Plate's `date` rule keeps only `value` and drops every other attribute.
const DATE_ATTRS = new Set(["value"]);

// Plate's `parseAttributes` spreads attributes over the element last, so `type` retitles the
// node to one no serialize rule answers for and `children` replaces the parsed subtree; `id`
// survives the parse and is stripped on the way out.
const RESERVED_ATTRS = new Set(["type", "children", "id"]);

// bare booleans (`<callout draft>`) come back from Plate as `draft="null"`, and braced
// expressions and spreads do not survive parseAttributes/propsToAttributes.
const isModellableAttribute = (
  tag: string,
  attribute: MdxJsxAttribute | MdxJsxExpressionAttribute,
): boolean => {
  if (!isLiteralAttribute(attribute)) {
    return false;
  }
  if (RESERVED_ATTRS.has(attribute.name)) {
    return false;
  }
  return tag !== "date" || DATE_ATTRS.has(attribute.name);
};

const isComponent = (node: MdxJsxFlowElement | MdxJsxTextElement): boolean => {
  const tag = node.name;
  // `<>` fragment
  if (tag === null) {
    return false;
  }
  const tags = node.type === "mdxJsxFlowElement" ? COMPONENT_FLOW_TAGS : COMPONENT_TEXT_TAGS;
  if (!tags.has(tag)) {
    return false;
  }
  return node.attributes.every((attribute) => isModellableAttribute(tag, attribute));
};

// toMarkdown always terminates with one newline; the opaque value is a fragment.
const render = (node: Nodes, options: ToMarkdownOptions): string =>
  toMarkdown(node, options).replace(/\n$/u, "");

// the `Record` is the exhaustiveness check the removed `switch` used to be: a node type this
// pipeline gains has no entry, so tsc rejects the table until someone decides its position.
// `null` means the slate model has a node for it, so it is never held as source.
const OPAQUE_POSITION: Record<Nodes["type"], "block" | "inline" | null> = {
  blockquote: null,
  break: null,
  code: null,
  commentMarker: null,
  definition: null,
  delete: null,
  emphasis: null,
  footnoteDefinition: null,
  footnoteReference: null,
  formulaPill: null,
  heading: null,
  // htmlFlow is disabled, so every `html` node comes from htmlText and sits in phrasing position.
  html: "inline",
  image: null,
  imageReference: null,
  inlineCode: null,
  inlineMath: null,
  link: null,
  linkReference: null,
  list: null,
  listItem: null,
  math: null,
  mdxFlowExpression: "block",
  mdxJsxFlowElement: "block",
  mdxJsxTextElement: "inline",
  mdxTextExpression: "inline",
  mdxjsEsm: null,
  opaqueBlock: null,
  opaqueInline: null,
  paragraph: null,
  root: null,
  strong: null,
  tabGroup: null,
  tabPanel: null,
  table: null,
  tableCell: null,
  tableRow: null,
  text: null,
  thematicBreak: null,
  wikiEmbed: null,
  wikiLink: null,
  yaml: null,
};

// exported for the knowledge scan, whose plain-markdown grammar sees ordinary constructs inside
// these regions; rename byte-surgery must not splice into bytes this pipeline returns unchanged.
export const isOpaqueSource = (node: Nodes): boolean => {
  if (OPAQUE_POSITION[node.type] === null) {
    return false;
  }
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    return !isComponent(node);
  }
  return true;
};

const toOpaque = (node: Nodes, options: ToMarkdownOptions): OpaqueBlock | OpaqueInline | null => {
  const position = OPAQUE_POSITION[node.type];
  if (position === null || !isOpaqueSource(node)) {
    return null;
  }
  // `html` is held verbatim; everything else is re-serialized from its subtree.
  const value = node.type === "html" ? node.value : render(node, options);
  return position === "block" ? { type: "opaqueBlock", value } : { type: "opaqueInline", value };
};

// top-down: an opaque node is rendered from its original subtree and not descended into; a
// component's children are still visited, so a `<Steps>` inside a `<callout>` goes opaque alone.
const makeOpaque = (node: Nodes, options: ToMarkdownOptions): void => {
  if (!("children" in node)) {
    return;
  }
  const children: Nodes[] = node.children;
  for (const [index, child] of children.entries()) {
    const opaque = toOpaque(child, options);
    if (opaque) {
      children[index] = opaque;
    } else {
      makeOpaque(child, options);
    }
  }
};

const opaqueToMarkdown: ToMarkdownOptions = {
  handlers: {
    opaqueBlock: (node: OpaqueBlock) => node.value,
    opaqueInline: Object.assign((node: OpaqueInline) => node.value, { peek: () => "<" }),
  },
};

// register last: it renders through whatever `toMarkdownExtensions` earlier plugins installed
// (the array is captured by reference).
export const remarkOpaque: Plugin<[ToMarkdownOptions]> = function remarkOpaque(
  this: Processor,
  stringify: ToMarkdownOptions,
) {
  const data = this.data();
  data.toMarkdownExtensions ??= [];
  const extensions = data.toMarkdownExtensions;
  extensions.push(opaqueToMarkdown);
  return (tree) => {
    if (isMdastRoot(tree)) {
      makeOpaque(tree, { ...stringify, extensions });
    }
  };
};
