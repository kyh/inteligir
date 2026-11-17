// The library's rows that read, routed beside the ones that write (`../rpc/library-router`): each
// side keeps a module of its own, and `items` holds rows of both. A read takes no lock: one of a
// single statement answers from the rows as it finds them, and one of several reads one snapshot.

import { answerCard } from "@repo/contract/library/library-index";
import { NotFoundError } from "@repo/contract/rpc/v1-errors";
import { db } from "@repo/db/drizzle-client";

import { reading } from "./library-access";
import { listingPage, listingScopes, listingTitles, readLibrary } from "./library-listing";
import { libraryOutline, listItems, readItemView, searchItems } from "./library-reads";
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
    list: reading.items.list.handler(
      async ({ context, input }) =>
        await readLibrary(async (tx) => await listItems(tx, context.library.accountId, input)),
    ),
    read: reading.items.read.handler(async ({ context, input }) => {
      const view = await readLibrary(
        async (tx) => await readItemView(tx, context.library.accountId, input),
      );
      if (view === null) {
        throw new NotFoundError();
      }
      return view;
    }),
    row: reading.items.row.handler(async ({ context, input }) => {
      const held = await readItem(db, context.library.accountId, input.id);
      if (held === null) {
        throw new NotFoundError();
      }
      return itemRow(held);
    }),
  },
  listing: {
    page: reading.listing.page.handler(
      async ({ context, input }) =>
        await readLibrary(async (tx) => await listingPage(tx, context.library.accountId, input)),
    ),
    scopes: reading.listing.scopes.handler(
      async ({ context }) =>
        await readLibrary(async (tx) => await listingScopes(tx, context.library.accountId)),
    ),
    titles: reading.listing.titles.handler(
      async ({ context }) => await listingTitles(db, context.library.accountId),
    ),
  },
  organize: {
    outline: reading.organize.outline.handler(
      async ({ context }) =>
        await readLibrary(async (tx) => await libraryOutline(tx, context.library.accountId)),
    ),
  },
  search: reading.search.handler(
    async ({ context, input }) =>
      await readLibrary(async (tx) => await searchItems(tx, context.library.accountId, input)),
  ),
};
