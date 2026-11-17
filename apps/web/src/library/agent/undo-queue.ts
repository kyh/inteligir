// An Undo press as the cell takes it (`library.agent.undo`): one turn, or the conversation, which
// the cell takes back so many turns a call; and the one queue every press waits in.

import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { useIsMutating } from "@tanstack/react-query";

type UndoPress = InferClientInputs<V1Client>["library"]["agent"]["undo"];
type Undone = InferClientOutputs<V1Client>["library"]["agent"]["undo"];

// one undo after another, in the order they were asked: each writes the open item in its onMutate,
// not before it, so a press takes its place the moment it is made, however long that write takes
export const UNDO_SCOPE = { id: "undo" };

// Every Undo is held down while one waits or runs, so a second press never asks for what the first
// is taking back. Read from the queue itself, so it holds for a press made before leaving here and
// coming back.
export const useUndoWaits = (): boolean =>
  useIsMutating({ predicate: ({ options }) => options.scope?.id === UNDO_SCOPE.id }) > 0;

// A press to its end, answered as one: the cell names where the turns a call left start, and a
// conversation's undo asks on from there until none wait. One turn's is one call.
export const undoToEnd = async (client: V1Client, press: UndoPress): Promise<Undone> => {
  const lots: Undone[] = [];
  let ask = press;
  for (;;) {
    const lot = await client.library.agent.undo(ask);
    lots.push(lot);
    if (lot.next === null) {
      return {
        kept: lots.flatMap((one) => one.kept),
        next: null,
        refused: lots.flatMap((one) => one.refused),
        reverted: lots.flatMap((one) => one.reverted),
      };
    }
    ask = { before: lot.next, threadId: press.threadId };
  }
};
