// The mdast the dialect's plugins read markdown into, as Plate's deserialize hands it to the rules,
// for a suite that holds the tree or times the parse rather than the blocks.

import type { Root } from "mdast";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "../markdown/md-plugins";
import { isMdastRoot } from "../markdown/mdast-nodes";

const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS).freeze();

export const mdastOf = (md: string): Root => {
  const tree = processor.runSync(processor.parse(md), md);
  if (!isMdastRoot(tree)) {
    throw new Error("the parse answered no mdast root");
  }
  return tree;
};

// the writer's extensions the dialect's plugins register
export const writerExtensions = (): ToMarkdownOptions[] =>
  processor.data("toMarkdownExtensions") ?? [];
