// Opaque nodes — the one primitive that lets the editor open a file it does not
// understand. A construct the Slate model has no node for (raw HTML, a `{…}`
// expression, JSX that is not one of the app's components) is replaced, at
// parse time, by an `opaqueBlock` / `opaqueInline` node holding that
// construct's markdown as a STRING. The editor shows the string as inert
// literal text and serializes it back verbatim, so it survives edits elsewhere
// in the document byte-for-byte. That is how a plain-text editor behaves: it
// does not understand `<div>` either, it just never touches it.
//
// The alternative is refusing the whole document, and it is not hypothetical:
// unknown JSX deserializes to escaped TEXT, so without a node to carry it the
// first save mangles `<Foo>` into `\<Foo>` prose, and the only safe answer is
// to open the file in Raw mode. Carrying it is what makes Raw a fallback for
// genuinely malformed input alone — a mismatched tag, an unbalanced brace.
//
// The value is produced by re-serializing the node, NOT by slicing the source.
// A slice is byte-exact only where no container prefixes the lines it spans —
// inside a blockquote it would capture the `> ` markers and the stringifier
// would add a second set. Re-serializing yields a self-contained string the
// stringifier can indent into any container, and it lands on the same canonical
// form the app's own components use, so an opaque block that was already
// canonical round-trips byte-identically.

import type { Node, Nodes, Root } from "mdast";
import type {
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from "mdast-util-mdx";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { toMarkdown } from "mdast-util-to-markdown";

/** A flow-position construct the editor cannot model, held verbatim. */
export interface OpaqueBlock extends Node {
  type: "opaqueBlock";
  /** Self-contained markdown for the construct, emitted back unescaped. */
  value: string;
}
/** A phrasing-position construct the editor cannot model, held verbatim. */
export interface OpaqueInline extends Node {
  type: "opaqueInline";
  /** Self-contained markdown for the construct, emitted back unescaped. */
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

// The app's MDX components — the ONLY JSX with a real editor node behind it.
// Flow tags map to block nodes; `date` is the only inline (text) element, but
// it is also admitted in flow position because a paragraph holding nothing but
// a date chip serializes to `<date value="…" />` alone on its line, which
// micromark re-reads as a flow element.
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

// Plate's `date` rule keeps only `value` and DROPS every other attribute, so a
// `<date>` carrying anything else is not modellable — opaque, not silently
// truncated on the first save.
const DATE_ATTRS = new Set(["value"]);

// Names that are the Slate NODE's own, on every tag. Plate's `parseAttributes`
// spreads the attributes over the element it builds and spreads them LAST, so
// one of these overwrites the field rather than arriving as a prop: `type`
// retitles the node to something no serialize rule answers for and the block
// vanishes on the next save, and `children` replaces the parsed subtree with a
// string. `id` survives the parse and is dropped on the way out, because the
// flow rules strip the id Plate's own NodeIdPlugin leaks. All three are the
// `DATE_ATTRS` case generalized — an attribute the round trip cannot carry
// belongs to an opaque node, which holds it verbatim.
const RESERVED_ATTRS = new Set(["type", "children", "id"]);

// Every attribute on a component must be a plain string-valued
// `mdxJsxAttribute`: bare booleans (`<callout draft>`) come back from Plate as
// `draft="null"`, and braced expressions and spreads do not survive
// parseAttributes/propsToAttributes. Unknown attribute NAMES are otherwise fine
// on the flow tags — their rules spread string props both directions.
function isModellableAttribute(
  tag: string,
  attribute: MdxJsxAttribute | MdxJsxExpressionAttribute,
): boolean {
  if (attribute.type !== "mdxJsxAttribute") return false;
  if (typeof attribute.value !== "string") return false;
  if (RESERVED_ATTRS.has(attribute.name)) return false;
  return tag !== "date" || DATE_ATTRS.has(attribute.name);
}

function isComponent(node: MdxJsxFlowElement | MdxJsxTextElement): boolean {
  const tag = node.name;
  if (tag === null) return false; // `<>` fragment
  const tags = node.type === "mdxJsxFlowElement" ? COMPONENT_FLOW_TAGS : COMPONENT_TEXT_TAGS;
  if (!tags.has(tag)) return false;
  return node.attributes.every((attribute) => isModellableAttribute(tag, attribute));
}

// toMarkdown always terminates a document with one newline; the opaque value is
// a fragment, so that terminator is not part of it.
function render(node: Nodes, options: ToMarkdownOptions): string {
  return toMarkdown(node, options).replace(/\n$/, "");
}

/** Does this node go opaque — held verbatim instead of modelled? Exported
 * because the knowledge scan reads a DIFFERENT, plain-markdown grammar
 * (../knowledge/link-extract) that sees ordinary constructs inside these
 * regions, and rename byte-surgery must not splice into bytes this pipeline
 * promises to return unchanged. */
export function isOpaqueSource(node: Nodes): boolean {
  switch (node.type) {
    case "html":
    case "mdxFlowExpression":
    case "mdxTextExpression":
      return true;
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement":
      return !isComponent(node);
    default:
      return false;
  }
}

function toOpaque(node: Nodes, options: ToMarkdownOptions): OpaqueBlock | OpaqueInline | null {
  if (!isOpaqueSource(node)) return null;
  switch (node.type) {
    // htmlFlow is disabled (remark-mdx-agnostic), so every `html` node comes
    // from htmlText and sits in phrasing position. Its value IS its source.
    case "html":
      return { type: "opaqueInline", value: node.value };
    case "mdxFlowExpression":
    case "mdxJsxFlowElement":
      return { type: "opaqueBlock", value: render(node, options) };
    case "mdxTextExpression":
    case "mdxJsxTextElement":
      return { type: "opaqueInline", value: render(node, options) };
    default:
      return null;
  }
}

// Top-down: a node that becomes opaque is rendered from its ORIGINAL subtree
// and not descended into, so an opaque node never appears inside a `render`
// input. A component's children are still visited — a `<Steps>` inside a
// `<callout>` goes opaque on its own without taking the callout with it.
function makeOpaque(node: Nodes, options: ToMarkdownOptions): void {
  if (!("children" in node)) return;
  const children: Nodes[] = node.children;
  for (const [index, child] of children.entries()) {
    const opaque = toOpaque(child, options);
    if (opaque) children[index] = opaque;
    else makeOpaque(child, options);
  }
}

const opaqueToMarkdown: ToMarkdownOptions = {
  handlers: {
    opaqueBlock: (node: OpaqueBlock) => node.value,
    opaqueInline: Object.assign((node: OpaqueInline) => node.value, { peek: () => "<" }),
  },
};

function isRoot(node: Node): node is Root {
  return node.type === "root";
}

/** The remark attacher, bound by its caller to the stringify conventions the
 * rest of the pipeline uses, so an opaque value is canonical in the same sense
 * every other block is. Register it LAST: it renders through whatever
 * `toMarkdownExtensions` the earlier plugins installed, so it must see all of
 * them (the array is captured by reference, not copied). */
export const remarkOpaque: Plugin<[ToMarkdownOptions]> = function (
  this: Processor,
  stringify: ToMarkdownOptions,
) {
  const data = this.data();
  const extensions = (data.toMarkdownExtensions ??= []);
  extensions.push(opaqueToMarkdown);
  return (tree) => {
    if (isRoot(tree)) makeOpaque(tree, { ...stringify, extensions });
  };
};
