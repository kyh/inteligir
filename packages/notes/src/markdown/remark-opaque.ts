// a construct the slate model has no node for is held as a string and serialized back verbatim;
// without one, a tag deserializes to escaped text and the first save mangles `<Foo>` into
// `\<Foo>`. With htmlFlow disabled every such construct is phrasing, so the string is inline. An
// element's value is re-serialized, not sliced from source: a slice spanning lines inside a
// blockquote would capture the `> ` markers and the stringifier would add a second set.

import type { Node, Nodes } from "mdast";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { toMarkdown } from "mdast-util-to-markdown";

import { isMdastRoot } from "./mdast-nodes";

export interface OpaqueInline extends Node {
  type: "opaqueInline";
  value: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    opaqueInline: OpaqueInline;
  }
  interface RootContentMap {
    opaqueInline: OpaqueInline;
  }
}

// Plate's types declare mdx's nodes on mdast, and this package's files are compiled inside the
// editor's program as well as its own, where they do not exist; the grammar never produces one.
export type PlateDeclaredType =
  | "mdxFlowExpression"
  | "mdxJsxFlowElement"
  | "mdxJsxTextElement"
  | "mdxTextExpression"
  | "mdxjsEsm";

type GrammarNodeType = Exclude<Nodes["type"], PlateDeclaredType>;

// the `Record` is the exhaustiveness check: a node type this pipeline gains has no entry, so tsc
// rejects the table until someone decides whether the editor holds it as source.
const HELD_AS_SOURCE: Record<GrammarNodeType, boolean> = {
  blockquote: false,
  break: false,
  code: false,
  column: false,
  columnGroup: false,
  annotationMarker: false,
  date: false,
  definition: false,
  delete: false,
  emphasis: false,
  footnoteDefinition: false,
  footnoteReference: false,
  formulaPill: false,
  heading: false,
  // a tag nothing pairs
  html: true,
  // a pair of tags the editor has no mark for
  htmlElement: true,
  image: false,
  imageReference: false,
  inlineCode: false,
  inlineMath: false,
  link: false,
  linkReference: false,
  list: false,
  listItem: false,
  math: false,
  opaqueInline: false,
  paragraph: false,
  root: false,
  strong: false,
  tabGroup: false,
  tabPanel: false,
  table: false,
  tableCell: false,
  tableRow: false,
  text: false,
  thematicBreak: false,
  toggle: false,
  underline: false,
  wikiEmbed: false,
  wikiLink: false,
  yaml: false,
};

const isGrammarNodeType = (type: string): type is GrammarNodeType =>
  Object.hasOwn(HELD_AS_SOURCE, type);

// exported for the knowledge scan, which reads this grammar's bare tree: a link inside one of these
// is the editor's string, not its link, so rename byte-surgery must not splice into it.
export const isOpaqueSource = (node: Nodes): boolean =>
  isGrammarNodeType(node.type) && HELD_AS_SOURCE[node.type];

// toMarkdown always terminates with one newline; the opaque value is a fragment.
const render = (node: Nodes, options: ToMarkdownOptions): string =>
  toMarkdown(node, options).replace(/\n$/u, "");

const toOpaque = (node: Nodes, options: ToMarkdownOptions): OpaqueInline | null => {
  if (!isOpaqueSource(node)) {
    return null;
  }
  return { type: "opaqueInline", value: node.type === "html" ? node.value : render(node, options) };
};

// top-down: an opaque node is rendered from its original subtree and not descended into.
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
