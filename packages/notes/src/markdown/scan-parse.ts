// The grammar every source-side SCAN reads — the one parse the knowledge
// engine runs over a doc.
//
// Two constructs are disabled and both are load-bearing. A checkbox has no id,
// so everything that points at one points at its POSITION in this count
// (../knowledge/task-ordinal) — which means the count has to agree with the set
// of checkboxes the editor DRAWS, or a projected ordinal names a different line
// than the one the reader is looking at. The
// editor renders through a different parser (@repo/editor over lezer-markdown),
// and CommonMark's defaults are where the two diverge: indented code hides a
// 4-space-indented `- [ ]` the editor still shows, and flow HTML lets one
// `<div>x</div>` line swallow every task line under it. That agreement is
// pinned from the other side, by @repo/editor's checkbox-toggle suite.
//
// The parse is TOTAL: it never throws, so a doc nothing else can make sense of
// still indexes.

import type { Root } from "mdast";
import type { Plugin, Processor } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { remarkWikiLink } from "./remark-wiki-link";

const remarkPlainBlocks: Plugin = function (this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ["codeIndented", "htmlFlow"] } });
};

const processor = unified()
  .use(remarkParse)
  .use(remarkPlainBlocks)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkWikiLink);

/** Parse a doc into the tree every knowledge scan reads. Total by construction:
 * it never throws, whatever the bytes. */
export function parseScan(source: string): Root {
  return processor.parse(source);
}
