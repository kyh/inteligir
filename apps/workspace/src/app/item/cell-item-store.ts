// The open item's store over the cell (`@repo/editor/item/item-session`'s ItemStore): an item is
// read whole from `library.items.get`, a write goes to `library.write` with the bases its ops name,
// and a base the cell answers CONFLICT on is read again, so the session merges it three ways and
// writes once more. What moved comes from the account's socket: an item moved by a write this
// page did not make, or past the copy it last read, is read again.

import { safe } from "@orpc/client";
import type { HeldItem, ItemStore } from "@repo/editor/item/item-session";

import type { LibrarySocket } from "../cloud/use-library-socket";
import type { CloudWire } from "../cloud/v1";

const NOTHING = new Set<string>();

export const createCellItemStore = (
  { client }: Pick<CloudWire, "client">,
  socket: Pick<LibrarySocket, "onItems">,
): ItemStore => {
  // each item's sequence as this page last read it, and the sequences its own writes landed at
  const readAt = new Map<string, number>();
  const wroteAt = new Map<string, Set<number>>();

  // a moved item's frame names its sequence; this page already holds it when it read that far, or
  // when its own write landed there
  const holds = (id: string, seq: number): boolean => {
    if (seq <= (readAt.get(id) ?? -1)) {
      return true;
    }
    return wroteAt.get(id)?.delete(seq) ?? false;
  };

  const read = async (id: string): Promise<HeldItem | null> => {
    const answer = await safe(client.library.items.get({ id }));
    if (answer.isSuccess) {
      const item = answer.data;
      readAt.set(id, Math.max(item.seq, readAt.get(id) ?? -1));
      return { blocks: item.blocks, bodyHeld: true, fields: item.fields };
    }
    if (answer.definedError?.code === "NOT_FOUND") {
      return null;
    }
    throw answer.error;
  };

  return {
    item: read,
    onChange: (listener) =>
      socket.onItems((moved) => {
        if (moved === null) {
          listener({ ids: NOTHING, overlapped: NOTHING, reset: true });
          return;
        }
        const ids = new Set([...moved].filter(([id, seq]) => !holds(id, seq)).map(([id]) => id));
        if (ids.size > 0) {
          listener({ ids, overlapped: NOTHING, reset: false });
        }
      }),
    write: async (itemId, { ops }) => {
      const answer = await safe(
        client.library.write({ itemId, ops: [...ops], opId: crypto.randomUUID() }),
      );
      if (answer.isSuccess) {
        const own = wroteAt.get(itemId) ?? new Set();
        own.add(answer.data.item.seq);
        wroteAt.set(itemId, own);
        return { kind: "queued" };
      }
      switch (answer.definedError?.code) {
        case "CONFLICT": {
          const item = await read(itemId);
          return item === null ? { kind: "missing" } : { item, kind: "changed" };
        }
        case "NOT_FOUND": {
          return { kind: "missing" };
        }
        default: {
          throw answer.error;
        }
      }
    },
  };
};
