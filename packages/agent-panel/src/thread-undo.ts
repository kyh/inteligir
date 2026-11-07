// "Undo this turn" and "Undo this conversation": the change sets the built-in agent's turns made in
// one thread, as History lists them (newest first), less those already undone or still open. A
// turn's writes are one set, so its undo is that set; a conversation's is every one of them,
// newest first, in one undo of its own, or in as few as the cell takes when the conversation made
// more sets than one undo names.

import { BULK_ITEMS_MAX } from "@repo/contract/cloud/library/library-wire";
import type { changeSetSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

export type ChangeSet = z.infer<typeof changeSetSchema>;

// the sets of every page of History asked so far, each once: the pages are counted from the
// newest, so a set made after an older page was asked moves the next page's first set onto it
// again
export const changeSetsOf = (
  pages: readonly { readonly changeSets: readonly ChangeSet[] }[],
): ChangeSet[] => {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.changeSets.filter((set) => {
      if (seen.has(set.id)) {
        return false;
      }
      seen.add(set.id);
      return true;
    }),
  );
};

const undoable = (set: ChangeSet): boolean => set.undoneBy === null && set.closedAt !== null;

// the set one turn made, while it can be undone; null for a turn that changed nothing
export const turnUndo = (sets: readonly ChangeSet[], turn: number): string[] | null => {
  const ids = sets.filter((set) => set.turn === turn && undoable(set)).map((set) => set.id);
  return ids.length === 0 ? null : ids;
};

// every set the thread's turns made that can still be undone, newest first
export const conversationUndo = (sets: readonly ChangeSet[]): string[] | null => {
  const ids = sets.filter((set) => set.threadId !== null && undoable(set)).map((set) => set.id);
  return ids.length === 0 ? null : ids;
};

// the undos that take `ids` back, newest first, each naming as many sets as one undo takes
export const undoBatches = (ids: readonly string[]): string[][] => {
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += BULK_ITEMS_MAX) {
    batches.push(ids.slice(start, start + BULK_ITEMS_MAX));
  }
  return batches;
};
