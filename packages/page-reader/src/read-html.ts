// A page's html read into its facts and its article as the library's blocks, its ids the host's.
// The article is read as a tree, html to hast to mdast to blocks (`./article-tree`), and held to
// the page's own words (`./page-words`): where the tree keeps under 97% of their letters, or the
// editor refuses it, or no parser takes the page, the article is those words as plain paragraphs.
// It is typed by its DOM-free signature (`./read-html-api`), which a program with no DOM (the
// Worker's) reads through this entry's `types` condition.

import type { Root } from "mdast";

import { deriveBody } from "@repo/contract/library/derive-item";
import { articleBlocks } from "@repo/editor/codec/item-markdown";
import type { ArticleBlocks } from "@repo/editor/codec/item-markdown";
import { lettersKept } from "@repo/editor/markdown/markdown-doc";

import { articleMdast, articleTree } from "./article-tree";
import { extractPage } from "./extract-page";
import type { Rung } from "./page-facts";
import { DOM, HAST, paragraphsTree, wordsOf } from "./page-words";
import type { ReadHtml } from "./read-html-api";

const KEPT_MIN = 0.97;

interface ArticleRead {
  readonly article: ArticleBlocks;
  readonly rung: Rung | null;
}

const NOT_READ: ArticleRead = { article: { blocks: [], refused: 0 }, rung: null };

// the text an item's article reads as, which the page's words are counted in
const textOf = (article: ArticleBlocks): string =>
  deriveBody(article.blocks.map((block) => ({ block, section: "article" }))).text;

export const readHtml: ReadHtml = (args, newBlockId) => {
  const { facts, readable } = extractPage(args);
  const read = (tree: Root, rung: Rung): ArticleRead | null => {
    const article = articleBlocks(tree, newBlockId);
    return article === null ? null : { article, rung };
  };
  const asWords = (paragraphs: readonly string[]): ArticleRead =>
    read(paragraphsTree(paragraphs), "text") ?? NOT_READ;
  // a video's or a song's page holds no prose, so its description is its article's one paragraph
  if (args.prefer === "description" && facts.description !== null) {
    return { facts, ...asWords([facts.description]) };
  }
  if (readable.kind === "body") {
    return { facts, ...asWords(wordsOf(readable.body, DOM)) };
  }
  const tree = articleTree(readable.html);
  const words = wordsOf(tree, HAST);
  const rich = read(articleMdast(tree, args.url), "rich");
  return rich !== null && lettersKept(words.join("\n"), textOf(rich.article)) >= KEPT_MIN
    ? { facts, ...rich }
    : { facts, ...asWords(words) };
};
