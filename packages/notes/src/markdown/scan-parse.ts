// The grammar every source-side SCAN reads — the knowledge engine's parse, as
// opposed to the editor's own pipeline (./md-plugins).
//
// Two constructs are disabled and both are load-bearing. The editor's flavor has
// no indented code, so a 4-space-indented `- [ ]` is a live task there; and no
// flow HTML, so a `<div>x</div>` line does not swallow the lines after it. A
// scan reading CommonMark's defaults would therefore count a DIFFERENT set of
// task items than the editor shows — and a checkbox is addressed by its position
// in that count (../knowledge/task-ordinal), so one stray HTML-ish line would
// point delegation at the wrong task.
//
// Only those two are adopted. The rest of the editor's stack (math, the
// MDX-agnostic plugins, the opaque transform) only re-shapes nodes whose TEXT
// content still parses here, and the full MDX pipeline THROWS on a malformed
// doc — this parse stays total, so a doc only Raw mode can open still indexes.

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
