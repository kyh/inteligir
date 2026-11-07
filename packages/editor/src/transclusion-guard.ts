// Only the open item's own embeds expand, so the one cycle left to refuse is the item embedding
// itself: content inside an embed renders its embeds as chips and never recurses.

import { NodeApi } from "platejs";
import type { TElement } from "platejs";

export type TransclusionDecision =
  | { kind: "chip"; reason: "unresolved" | "cycle" }
  | { kind: "render"; itemId: string };

export const decideTransclusion = (
  openItemId: string | null,
  resolved: string | null,
): TransclusionDecision => {
  if (resolved === null) {
    return { kind: "chip", reason: "unresolved" };
  }
  if (resolved === openItemId) {
    return { kind: "chip", reason: "cycle" };
  }
  return { itemId: resolved, kind: "render" };
};

export const EMBED_PART_GONE = "That part isn't in this item any more.";

const HEADING_LEVEL = new Map([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

const levelOf = (block: TElement): number => HEADING_LEVEL.get(block.type) ?? Infinity;

const looseText = (text: string): string => text.toLowerCase().replaceAll(/\s+/gu, "");

// a heading and what stands under it, up to the next heading of its level or above
const sectionOf = (blocks: readonly TElement[], heading: string): readonly TElement[] | null => {
  const wanted = looseText(heading);
  const start = blocks.findIndex(
    (block) => HEADING_LEVEL.has(block.type) && looseText(NodeApi.string(block)) === wanted,
  );
  const found = blocks[start];
  if (found === undefined) {
    return null;
  }
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((block) => levelOf(block) <= levelOf(found));
  return [found, ...(end === -1 ? rest : rest.slice(0, end))];
};

// what an embed shows of its target: all of it, one heading's section or one block, and null when
// that heading or block is gone
export const embeddedPart = (
  blocks: readonly TElement[],
  anchor: { readonly blockRef: string | undefined; readonly heading: string | undefined },
): readonly TElement[] | null => {
  if (anchor.blockRef !== undefined) {
    const block = blocks.find((candidate) => candidate.ref === anchor.blockRef);
    return block === undefined ? null : [block];
  }
  return anchor.heading === undefined ? blocks : sectionOf(blocks, anchor.heading);
};
