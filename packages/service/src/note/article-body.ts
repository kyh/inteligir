// A page's article in place of the one a body holds: where the old one began, or after everything
// when it had none, the person's own blocks kept where they stand. The cell does this to a seed, and
// a note to its live document through the same changes any writer's edit takes.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import type { BodyChange } from "@repo/editor/live/body-change";

const articleAt = (blocks: readonly BodyBlock[]): number => {
  const at = blocks.findIndex(({ section }) => section === "article");
  return at === -1 ? blocks.length : at;
};

export const withArticle = (
  blocks: readonly BodyBlock[],
  article: readonly LibraryBlock[],
): BodyBlock[] => {
  const at = articleAt(blocks);
  const kept = blocks.filter(({ section }) => section === "note");
  const before = blocks.slice(0, at).filter(({ section }) => section === "note").length;
  return [
    ...kept.slice(0, before),
    ...article.map((block): BodyBlock => ({ block, section: "article" })),
    ...kept.slice(before),
  ];
};

export const articleChanges = (
  blocks: readonly BodyBlock[],
  article: readonly LibraryBlock[],
): BodyChange[] => {
  const at = articleAt(blocks);
  let afterId = blocks.slice(0, at).findLast(({ section }) => section === "note")?.block.id ?? null;
  const changes: BodyChange[] = blocks
    .filter(({ section }) => section === "article")
    .map(({ block }) => ({ base: block, blockId: block.id, kind: "drop" }));
  for (const block of article) {
    changes.push({ afterId, block, kind: "insertAfter", section: "article" });
    afterId = block.id;
  }
  return changes;
};
