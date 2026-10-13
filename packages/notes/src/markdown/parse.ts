// not Plate's `deserializeMd` (`@repo/editor/kits/markdown-kit` says why). The grammar is total
// (no expressions, no jsx, and a tag nothing closes stays html), so every input yields a tree and no
// note opens raw for its bytes.

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { isMdastRoot } from "./mdast-nodes";
import { MD_REMARK_PLUGINS } from "./md-plugins";
import { rebaseParsedOffsets } from "./parsed-offsets";
import { escapePillPipesInTables } from "./table-pipes";

// `text` is what the positions index: the pill-pipe escape shifts columns, so a caller cutting
// source by offset cuts this, not its own input.
export interface ParsedMarkdown {
  root: Root;
  text: string;
}

const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS).freeze();

// runSync is where the transformer plugins act, so this tree differs from ./bare-parse's. pill
// pipes in table cells are escaped ahead of micromark.
export const parseMdast = (md: string): ParsedMarkdown => {
  const text = escapePillPipesInTables(md);
  const tree = processor.runSync(processor.parse(text));
  if (!isMdastRoot(tree)) {
    throw new Error("markdown transform returned a non-root node");
  }
  rebaseParsedOffsets(tree, text);
  return { root: tree, text };
};
