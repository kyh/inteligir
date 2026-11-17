// The mdast the dialect's plugins read markdown into, as Plate's deserialize hands it to the rules,
// for a suite that holds the tree or times the parse rather than the blocks.

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "../headless/markdown/md-plugins";
import { isMdastRoot } from "../headless/markdown/mdast-nodes";

const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS).freeze();

export const mdastOf = (md: string): Root => {
  const tree = processor.runSync(processor.parse(md), md);
  if (!isMdastRoot(tree)) {
    throw new Error("the parse answered no mdast root");
  }
  return tree;
};
