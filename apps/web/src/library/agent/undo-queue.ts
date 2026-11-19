import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { useIsMutating } from "@tanstack/react-query";

type UndoPress = InferClientInputs<V1Client>["library"]["agent"]["undo"];

type Undone = InferClientOutputs<V1Client>["library"]["agent"]["undo"];

export const UNDO_SCOPE = { id: "undo" };

export const useUndoWaits = () =>
  useIsMutating({ predicate: ({ options }) => options.scope?.id === UNDO_SCOPE.id }) > 0;

export const undoToEnd = async (client: V1Client, press: UndoPress) => {
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
      } satisfies Undone;
    }

    ask = { before: lot.next, threadId: press.threadId };
  }
};
