// The one answer to "what does a stale write do?": every write carries the base it was computed
// from, and a block two writers changed is merged three ways over each side's markdown
// (`codec/block-markdown.ts`), as the open item's session lays a change from elsewhere in and as
// the replica settles every block a CONFLICT names (`mergeBlocks`).

import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { diff3 } from "@repo/notes/text/diff3";

import { blockFromMarkdown, faithfulMarkdown, filesIn, renamedBlock } from "./codec/block-markdown";

// a block two writers changed, as the replica hands it over: `base` as this device's write was
// computed from it, `mine` as it wrote it, `theirs` as the cell holds it now
interface BlockSides {
  readonly base: LibraryBlock;
  readonly mine: LibraryBlock;
  readonly theirs: LibraryBlock;
}

// a block both sides changed, merged: `overlapped` where both changed the same lines and mine
// were kept over theirs, which the person is told of
interface MergedBlock {
  readonly block: LibraryBlock;
  readonly overlapped: boolean;
}

// a block both sides changed, merged as the editor lays a change from elsewhere in, and as the
// replica settles a CONFLICT: the lines each side changed both land and an overlap keeps mine; a
// side whose markdown does not read back as itself, or a merge that reads back as no one block,
// keeps mine whole over theirs, an overlap too. The answer keeps theirs' id, and the `ref`
// whichever side moved it.
export const mergeBlocks = ({ base, mine, theirs }: BlockSides): MergedBlock => {
  const ref = mine.ref === base.ref ? theirs.ref : mine.ref;
  const kept = (block: LibraryBlock, overlapped: boolean): MergedBlock => ({
    block: renamedBlock(block, theirs.id, ref),
    overlapped,
  });
  const files = filesIn([base, mine, theirs]);
  const baseText = faithfulMarkdown(base, files);
  const mineText = faithfulMarkdown(mine, files);
  const theirsText = faithfulMarkdown(theirs, files);
  if (baseText === null || mineText === null || theirsText === null) {
    return kept(mine, true);
  }
  const { conflicted, merged } = diff3(baseText, mineText, theirsText);
  if (merged === mineText) {
    return kept(mine, conflicted);
  }
  if (merged === theirsText) {
    return kept(theirs, conflicted);
  }
  const read = blockFromMarkdown(merged, theirs.id, files);
  return read === null ? kept(mine, true) : kept(read, conflicted);
};
