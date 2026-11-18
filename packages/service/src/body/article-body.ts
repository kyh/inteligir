// A page's article in place of the one a body holds: where the old one began, or after everything
// when it had none, the person's own blocks kept where they stand. It runs on the body as the write
// landing the page reads it under the account's lock, so no save comes between the two.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

export const withArticle = (
  blocks: readonly BodyBlock[],
  article: readonly LibraryBlock[],
): BodyBlock[] => {
  const at = blocks.findIndex(({ section }) => section === "article");
  const kept = blocks.filter(({ section }) => section === "note");
  const before = blocks
    .slice(0, at === -1 ? blocks.length : at)
    .filter(({ section }) => section === "note").length;
  return [
    ...kept.slice(0, before),
    ...article.map((block): BodyBlock => ({ block, section: "article" })),
    ...kept.slice(before),
  ];
};
