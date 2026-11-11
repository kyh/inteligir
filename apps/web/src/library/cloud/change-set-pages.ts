// One conversation's change sets as the cell pages them (`library.history.list`): newest first, a
// page at a time, each answer naming the cursor of the next, read to the last page so a
// conversation of many turns reaches every set the cell keeps; and the one queue every undo waits
// in.

import { useIsMutating } from "@tanstack/react-query";

import { changeSetsOf } from "../agent/thread-undo";
import type { CloudWire } from "./v1";

interface ThreadFilter {
  readonly threadId: string;
}

// one undo after another, in the order they were asked: each writes the open item in its onMutate,
// not before it, so a press takes its place the moment it is made, however long that write takes
export const UNDO_SCOPE = { id: "undo" };

// A set goes back once, and the cell refuses a whole undo that names one already undone, so every
// Undo is held down while anything waits in the queue, and a long conversation's undos join it a
// batch at a time, so a press let in behind one could read ahead of the next. Read from the queue
// itself, so it holds for a press made before leaving here and coming back.
export const useUndoWaits = (): boolean =>
  useIsMutating({ predicate: ({ options }) => options.scope?.id === UNDO_SCOPE.id }) > 0;

// every set as the cell holds them now, newest first: the conversation's query, and the press
// that must not act on a list still catching up, run in a mutation, since a bare call fails at
// once offline
export const everyChangeSet = async (
  client: CloudWire["client"],
  filter: ThreadFilter,
  signal?: AbortSignal,
) => {
  const pages = [];
  let cursor: string | undefined;
  do {
    const page = await client.library.history.list({ ...filter, cursor }, { signal });
    pages.push(page);
    cursor = page.cursor ?? undefined;
  } while (cursor !== undefined);
  return changeSetsOf(pages);
};
