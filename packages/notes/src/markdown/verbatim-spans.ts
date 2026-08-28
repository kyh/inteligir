// The source ranges the EDITOR carries as a STRING — opaque nodes (raw HTML,
// a `{…}` expression, JSX with no component behind it) and math, the two tiers
// whose bytes the round trip promises to return unchanged.
//
// They exist because the knowledge scan reads a different grammar. `scan-parse`
// is plain markdown and TOTAL by construction, so it cannot run the mdx
// tokenizer (which throws) and therefore cannot see these regions at all:
// `<div>[[A]]</div>`, `$$[[A]]$$` and `{ [[A]] }` each hold what that grammar
// calls a wiki link and what this one calls one verbatim string. Indexing such
// a link is harmless; REWRITING it is not, so the scan asks here before it
// hands rename byte-surgery a licence over those bytes.
//
// The oracle is the editor's own plugin list run as a bare `parse`: transformers
// never run, which is exactly what is wanted — the opaque transform would
// replace the nodes with position-less ones, and an MDX element stays visible as
// itself so `isOpaqueSource` can tell a modelled `<callout>` from an opaque
// `<div>`. `parse.ts`'s pill-pipe pre-pass is deliberately skipped: it rewrites
// bytes, so every offset it produced would name a different document than the
// caller's.

import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "./md-plugins";
import { isOpaqueSource } from "./remark-opaque";

/** A half-open code-unit range of the source. */
export type VerbatimSpan = { start: number; end: number };

const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS);

// No verbatim construct can open without one of these: JSX and raw HTML need
// `<`, an MDX expression `{`, math `$`. A doc holding none cannot hold a region,
// so it never pays for the second parse.
const VERBATIM_OPENER = /[<{$]/;

/**
 * Every verbatim range in `source`, outermost-only and in document order.
 *
 * Empty when the doc has none — and empty when the editor's grammar REFUSES the
 * doc, which is deliberate rather than conservative: that doc opens Raw, so it
 * has no round trip whose bytes could be broken.
 */
export function verbatimSpans(source: string): VerbatimSpan[] {
  if (!VERBATIM_OPENER.test(source)) return [];
  let tree: Nodes;
  try {
    tree = processor.parse(source);
  } catch {
    return [];
  }
  const spans: VerbatimSpan[] = [];
  collect(tree, spans);
  return spans;
}

/** Does `[start, end)` sit inside a verbatim range? */
export function insideVerbatim(
  spans: readonly VerbatimSpan[],
  start: number,
  end: number,
): boolean {
  return spans.some((span) => start >= span.start && end <= span.end);
}

// Math is modelled where the opaque nodes are not, but its LaTeX is a string the
// editor never re-parses — the same "carried, not understood" tier.
function isVerbatim(node: Nodes): boolean {
  return node.type === "math" || node.type === "inlineMath" || isOpaqueSource(node);
}

function collect(node: Nodes, out: VerbatimSpan[]): void {
  if (isVerbatim(node)) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) out.push({ start, end });
    return;
  }
  if ("children" in node) {
    for (const child of node.children) collect(child, out);
  }
}
