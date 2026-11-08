// a construct the slate model has no node for is held as a string and serialized back verbatim;
// without one, a tag deserializes to escaped text and the first save mangles `<Foo>` into
// `\<Foo>`. With htmlFlow disabled such a construct is phrasing and the string inline; a definition
// is the one that stands in a flow, so its string sits in a paragraph of its own.
// An element's value is re-serialized, not sliced from source: a slice spanning lines inside a
// blockquote would capture the `> ` markers and the stringifier would add a second set.

import type { Node, Nodes, Parents } from "mdast";
import type { Options as ToMarkdownOptions, State } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { toMarkdown } from "mdast-util-to-markdown";

import { escapeBarePipes } from "./line-scan";
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
type PlateDeclaredType =
  | "mdxFlowExpression"
  | "mdxJsxFlowElement"
  | "mdxJsxTextElement"
  | "mdxTextExpression"
  | "mdxjsEsm";

// a footnote is text by the time the parse ends (`./remark-references`)
type GrammarNodeType = Exclude<
  Nodes["type"],
  PlateDeclaredType | "footnoteDefinition" | "footnoteReference"
>;

// the `Record` is the exhaustiveness check: a node type this pipeline gains has no entry, so tsc
// rejects the table until someone decides whether the editor holds it as source.
const HELD_AS_SOURCE: Record<GrammarNodeType, boolean> = {
  articleSection: false,
  blockRef: false,
  blockquote: false,
  break: false,
  code: false,
  column: false,
  columnGroup: false,
  annotationMarker: false,
  date: false,
  // one no reference used (`./remark-references`)
  definition: true,
  delete: false,
  emphasis: false,
  formulaPill: false,
  heading: false,
  // a tag nothing pairs
  html: true,
  // a pair of tags the editor has no mark for
  htmlElement: true,
  image: false,
  // `./remark-references` reads every reference; one it missed would keep its words here
  imageReference: true,
  inlineCode: false,
  inlineMath: false,
  link: false,
  // as `imageReference`
  linkReference: true,
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

const LABEL = String.raw`(?:[^\]\\\n]|\\.)+`;
const DEFINITION_SOURCE_RE = new RegExp(String.raw`^\[${LABEL}\]:`, "u");

const holdsSource = (node: Nodes | undefined, source: RegExp): boolean => {
  if (node?.type !== "paragraph") {
    return false;
  }
  const [only, ...rest] = node.children;
  return only?.type === "opaqueInline" && rest.length === 0 && source.test(only.value);
};

// a paragraph that is a definition held as source, which the writer spaces as the construct its
// next read finds
export const isHeldDefinition = (node: Nodes | undefined): boolean =>
  holdsSource(node, DEFINITION_SOURCE_RE);

const isGrammarNodeType = (type: string): type is GrammarNodeType =>
  Object.hasOwn(HELD_AS_SOURCE, type);

// the library holds no link or image with no address, and a title is words it would take with it
const isTitleOnNoAddress = (node: Nodes): boolean =>
  (node.type === "link" || node.type === "image") && node.url === "" && (node.title ?? "") !== "";

const isOpaqueSource = (node: Nodes): boolean =>
  (isGrammarNodeType(node.type) && HELD_AS_SOURCE[node.type]) || isTitleOnNoAddress(node);

// toMarkdown always terminates with one newline; the opaque value is a fragment.
const render = (node: Nodes, options: ToMarkdownOptions): string =>
  toMarkdown(node, options).replace(/\n$/u, "");

const toOpaque = (node: Nodes, options: ToMarkdownOptions): Nodes | null => {
  if (!isOpaqueSource(node)) {
    return null;
  }
  const opaque: OpaqueInline = {
    type: "opaqueInline",
    value: node.type === "html" ? node.value : render(node, options),
  };
  return node.type === "definition" ? { children: [opaque], type: "paragraph" } : opaque;
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

// gfm-table has unescaped a text's pipes by the time a spelling is read from it, and a tag's
// children render with no table around them, so the cell's escape is written back here. A tag's
// bytes may already hold that escape, which a pill's decoded raw never does, so a pill's writer
// escapes every pipe and this one only a bare pipe: neither rule serves the other
const opaqueToMarkdown: ToMarkdownOptions = {
  handlers: {
    opaqueInline: Object.assign(
      (node: OpaqueInline, _parent: Parents | undefined, state: State) =>
        state.stack.includes("tableCell") ? escapeBarePipes(node.value) : node.value,
      { peek: () => "<" },
    ),
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
