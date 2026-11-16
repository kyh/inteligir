// A page's html read into its facts and its article as the library's blocks: the fixpoint the
// ladder wrote (`./extract-page`), read by the editor's codec as a page (no dialect link or
// Obsidian spelling reads in it), its ids the host's. It is typed by its DOM-free signature
// (`./read-html-api`), which a program with no DOM (the Worker's) reads through this entry's
// `types` condition.

import { articleBlocks } from "@repo/editor/codec/item-markdown";
import type { ArticleBlocks } from "@repo/editor/codec/item-markdown";

import { extractPage } from "./extract-page";
import type { ReadHtml } from "./read-html-api";

const NO_ARTICLE: ArticleBlocks = { blocks: [], refused: 0 };

export const readHtml: ReadHtml = (args, newBlockId) => {
  const page = extractPage(args);
  const article =
    page.article === "" ? NO_ARTICLE : (articleBlocks(page.article, newBlockId) ?? NO_ARTICLE);
  return { article, facts: page.facts, rung: page.rung };
};
