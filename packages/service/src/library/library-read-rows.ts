import { answerCard } from "@repo/contract/library/library-index";
import { NotFoundError } from "@repo/contract/rpc/v1-errors";
import { db } from "@repo/db/drizzle-client";

import { DIALECT_SPEC } from "../agent/agent-prompt";
import { reading } from "./library-access";
import { libraryChanges } from "./library-changes";
import { namedFiles, settleNotes } from "./library-imports";
import { listingPage, listingScopes, listingTitles, readLibrary } from "./library-listing";
import { libraryOutline, listItems, readItemView, searchItems } from "./library-reads";
import { readItemRow, readItemWhole } from "./library-rows";
import type { StoredItem } from "./library-rows";
import { undoableTurns } from "./library-undo";

const itemRow = ({ card, fields, id, seq, updatedAt }: StoredItem) => ({
  card: answerCard(card),
  fields,
  id,
  seq,
  updatedAt,
});

export const libraryReadRows = {
  agent: {
    undoable: reading.agent.undoable.handler(async ({ context, input }) => ({
      turns: await undoableTurns(db, context.library.accountId, input.threadId),
    })),
  },
  changes: reading.changes.handler(
    async ({ context, input }) => await libraryChanges(db, context.library.accountId, input.after),
  ),
  guide: reading.guide.handler(() => ({ markdown: DIALECT_SPEC })),
  imports: {
    named: reading.imports.named.handler(
      async ({ context, input }) => await namedFiles(db, context.library.accountId, input.shas),
    ),
    settle: reading.imports.settle.handler(async ({ context, input }) => ({
      notes: await settleNotes(db, context.library.accountId, input.notes),
    })),
  },
  items: {
    get: reading.items.get.handler(async ({ context, input }) => {
      const whole = await readItemWhole(db, context.library.accountId, input.id);

      if (whole === null) {
        throw new NotFoundError();
      }

      return { ...itemRow(whole.item), blocks: [...whole.blocks], bodyVersion: whole.bodyVersion };
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
      const held = await readItemRow(db, context.library.accountId, input.id);

      if (held === null) {
        throw new NotFoundError();
      }

      return { ...itemRow(held.item), bodyVersion: held.bodyVersion };
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
