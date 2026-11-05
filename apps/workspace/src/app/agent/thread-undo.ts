// "Undo this turn" and "Undo this conversation": the change sets the built-in agent's turns made in
// one thread, as History lists them (newest first), less those already undone or still open. A
// turn's writes are one set, so its undo is that set; a conversation's is every one of them,
// newest first, in one undo of its own (spec §3, "Undoing an agent session").

import type { changeSetSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

type ChangeSet = z.infer<typeof changeSetSchema>;

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
