import type { Root } from "mdast";

import { deriveBody } from "@repo/contract/library/derive-item";
import { articleBlocks } from "@repo/editor/headless/codec/item-markdown";
import type { ArticleBlocks } from "@repo/editor/headless/codec/item-markdown";
import { lettersKept } from "@repo/editor/headless/codec/markdown-doc";

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

const textOf = (article: ArticleBlocks) =>
  deriveBody(article.blocks.map((block) => ({ block, section: "article" }))).text;

export const readHtml: ReadHtml = (args, newBlockId) => {
  const { facts, readable } = extractPage(args);

  const read = (tree: Root, rung: Rung) => {
    const article = articleBlocks(tree, newBlockId);

    return (article === null ? null : { article, rung }) satisfies ArticleRead | null;
  };

  const asWords = (paragraphs: readonly string[]) =>
    read(paragraphsTree(paragraphs), "text") ?? NOT_READ;

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
