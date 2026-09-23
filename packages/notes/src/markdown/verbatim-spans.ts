// the knowledge scan's grammar cannot run the mdx tokenizer (it throws), so it sees
// `<div>[[A]]</div>` as a wiki link where the editor sees one verbatim string; indexing it is
// harmless, rewriting it is not. the oracle is the editor's plugin list as a bare `parse`:
// transformers never run, so mdx elements keep their positions and stay visible to
// `isOpaqueSource`. the pill-pipe pre-pass is skipped because it rewrites bytes and shifts offsets.

import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "./md-plugins";
import { rebaseParsedOffsets } from "./parsed-offsets";
import { isOpaqueSource } from "./remark-opaque";

export interface VerbatimSpan {
  start: number;
  end: number;
}

const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS);

// no verbatim construct can open without `<`, `{` or `$`, so a doc holding none skips the parse.
const VERBATIM_OPENER = /[<{$]/u;

// math's latex is a string the editor never re-parses: the same carried-not-understood tier.
const isVerbatim = (node: Nodes): boolean =>
  node.type === "math" || node.type === "inlineMath" || isOpaqueSource(node);

const pushSpan = (node: Pick<Nodes, "position">, out: VerbatimSpan[]): void => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined) {
    out.push({ end, start });
  }
};

const collect = (node: Nodes, out: VerbatimSpan[]): void => {
  if (isVerbatim(node)) {
    pushSpan(node, out);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collect(child, out);
    }
  }
};

// empty when the editor's grammar refuses the doc: it opens raw, so it has no round trip to break.
export const verbatimSpans = (source: string): VerbatimSpan[] => {
  if (!VERBATIM_OPENER.test(source)) {
    return [];
  }
  let tree: Nodes;
  try {
    tree = processor.parse(source);
  } catch {
    return [];
  }
  rebaseParsedOffsets(tree, source);
  const spans: VerbatimSpan[] = [];
  collect(tree, spans);
  return spans;
};

// bytes the grammar holds as a literal string, which the table-pipe pre-pass must leave as
// written. a jsx element is not one: its children are markdown, where the escape is what keeps a
// pill in one cell. each of its attributes is.
const isLiteral = (node: Nodes): boolean =>
  node.type === "code" ||
  node.type === "inlineCode" ||
  node.type === "math" ||
  node.type === "inlineMath" ||
  node.type === "yaml" ||
  node.type === "html" ||
  node.type === "mdxFlowExpression" ||
  node.type === "mdxTextExpression";

const collectLiteral = (node: Nodes, out: VerbatimSpan[]): void => {
  if (isLiteral(node)) {
    pushSpan(node, out);
    return;
  }
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    for (const attribute of node.attributes) {
      pushSpan(attribute, out);
    }
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectLiteral(child, out);
    }
  }
};

// null when the editor's grammar refuses the doc: there is no map of it to trust.
export const literalRanges = (source: string): VerbatimSpan[] | null => {
  let tree: Nodes;
  try {
    tree = processor.parse(source);
  } catch {
    return null;
  }
  rebaseParsedOffsets(tree, source);
  const ranges: VerbatimSpan[] = [];
  collectLiteral(tree, ranges);
  return ranges;
};

export const insideVerbatim = (
  spans: readonly VerbatimSpan[],
  start: number,
  end: number,
): boolean => spans.some((span) => start >= span.start && end <= span.end);
