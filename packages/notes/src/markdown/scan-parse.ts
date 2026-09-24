// total: it never throws, so a malformed tag cannot cost a note its place in the index; that is
// why this is not the editor's plugin list, whose mdx tokenizer throws. `codeIndented` and
// `htmlFlow` are disabled because the editor disables both: the index must read as prose what
// the editor draws as prose (indented code would hide a 4-space line's links and tags; flow html
// would let one `<div>x</div>` swallow every line under it).

import type { Root } from "mdast";
import type { Plugin, Processor } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { rebaseParsedOffsets } from "./parsed-offsets";
import { remarkWikiLink } from "./remark-wiki-link";

const remarkPlainBlocks: Plugin = function remarkPlainBlocks(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ["codeIndented", "htmlFlow"] } });
};

const processor = unified()
  .use(remarkParse)
  .use(remarkPlainBlocks)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkWikiLink);

export const parseScan = (source: string): Root => {
  const tree = processor.parse(source);
  rebaseParsedOffsets(tree, source);
  return tree;
};
