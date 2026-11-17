// The library's rows that read, routed beside the ones that write (`../rpc/library-router`): each
// side keeps a module of its own, and `items` holds rows of both. A read takes no lock: each answers
// from the rows as one statement finds them.

import { answerCard } from "@repo/contract/library/library-index";
import { NotFoundError } from "@repo/contract/rpc/v1-errors";
import { db } from "@repo/db/drizzle-client";

import { reading } from "./library-access";
import { readItem, readItemWhole } from "./library-rows";
import type { StoredItem } from "./library-rows";

// an item's row as the apps read it; one emptied from Deleted is no item
const itemRow = ({ card, fields, id, seq, updatedAt }: StoredItem) => ({
  card: answerCard(card),
  fields,
  id,
  seq,
  updatedAt,
});

export const libraryReadRows = {
  items: {
    get: reading.items.get.handler(async ({ context, input }) => {
      const whole = await readItemWhole(db, context.library.accountId, input.id);
      if (whole === null) {
        throw new NotFoundError();
      }
      return { ...itemRow(whole.item), blocks: [...whole.blocks] };
    }),
    row: reading.items.row.handler(async ({ context, input }) => {
      const held = await readItem(db, context.library.accountId, input.id);
      if (held === null) {
        throw new NotFoundError();
      }
      return itemRow(held);
    }),
  },
};
