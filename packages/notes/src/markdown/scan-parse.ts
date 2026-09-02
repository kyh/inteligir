// total: it never throws, so a malformed tag cannot cost a note its place in the index; that is
// why this is not the editor's plugin list, whose mdx tokenizer throws. `codeIndented` and
// `htmlFlow` are disabled to match the editor: a checkbox is addressed by its position, so this
// count must agree with the set the editor draws (indented code would hide a 4-space `- [ ]`;
// flow html would let one `<div>x</div>` swallow every task line under it).

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

export function parseScan(source: string): Root {
  return processor.parse(source);
}
