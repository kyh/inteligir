// the knowledge scan's grammar cannot run the mdx tokenizer (it throws), so it sees
// `<div>[[A]]</div>` as a wiki link where the editor sees one verbatim string; indexing it is
// harmless, rewriting it is not. the oracle is the editor's plugin list as a bare `parse`:
// transformers never run, so mdx elements keep their positions and stay visible to
// `isOpaqueSource`. the pill-pipe pre-pass is skipped because it rewrites bytes and shifts offsets.

import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "./md-plugins";
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

const collect = (node: Nodes, out: VerbatimSpan[]): void => {
  if (isVerbatim(node)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      out.push({ end, start });
    }
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
  const spans: VerbatimSpan[] = [];
  collect(tree, spans);
  return spans;
};

export const insideVerbatim = (
  spans: readonly VerbatimSpan[],
  start: number,
  end: number,
): boolean => spans.some((span) => start >= span.start && end <= span.end);
