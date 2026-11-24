import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

export const withArticle = (blocks: readonly BodyBlock[], article: readonly LibraryBlock[]) => {
  const at = blocks.findIndex(({ section }) => section === "article");
  const kept = blocks.filter(({ section }) => section === "note");

  const before = blocks
    .slice(0, at === -1 ? blocks.length : at)
    .filter(({ section }) => section === "note").length;

  return [
    ...kept.slice(0, before),
    ...article.map((block) => ({ block, section: "article" }) satisfies BodyBlock),
    ...kept.slice(before),
  ] satisfies BodyBlock[];
};
