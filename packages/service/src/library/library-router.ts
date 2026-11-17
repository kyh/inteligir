// The library's procedures, implemented once over the account's cell: `/v1/rpc/library` serves
// them to the apps (`./library-rpc`), the connector serves its tools to assistants, and the cell
// runs those for the built-in agent (`../agent/agent-tools`), each call by the actor its principal
// resolves to. Every write lands through the engine in one transaction, which joins the change set
// of the agent's turn that made it, tells the sockets and sets the alarm; every refusal answers as the error its row
// declares (`./library-orpc`). The built-in agent's rows are `../agent/agent-router`'s.

import { NotFoundError } from "@repo/contract/v1/errors";
import { sweptIds } from "@repo/contract/library/library-index";
import {
  folderRowSchema,
  itemSummarySchema,
  liveItemRowSchema,
} from "@repo/contract/library/library-wire";
import { noteFields } from "@repo/contract/library/item-makes";
import { z } from "zod";

import { DIALECT_SPEC } from "../agent/agent-prompt";
import { agentRouter } from "../agent/agent-router";
import { noteBlocksSchema } from "../note/note-wire";
import { landArticle } from "./article-landing";
import { heldBody } from "./cell-body";
import { cellCodec } from "./cell-codec";
import { editByNote } from "./cell-edits";
import { askFill, askFillAfterTurn } from "./cell-fills";
import { writeFolders } from "./cell-folders";
import { IMPORT_ACTOR, landImported, namedFiles, settleNote } from "./cell-imports";
import {
  createFile,
  createNote,
  landNew,
  organizeItems,
  purgeItems,
  refreshItem,
  setDeleted,
} from "./cell-items";
import { landProjection } from "./cell-notes";
import type { ItemScope, LiveItemRow } from "./cell-landing";
import { itemRow, itemWhole, listingPage } from "./cell-listing";
import { landedSummaries, listItems, readItemView, searchItems } from "./cell-reads";
import { saveLink, savePage } from "./cell-saves";
import { askSweep } from "./cell-sweeps";
import { landedSchema, landPropertyOps } from "./cell-writes";
import type { CellActor } from "./cell-actor";
import { libraryHead } from "./library-engine";
import { answer, os } from "./library-orpc";
import type { CellContext } from "./library-orpc";

const savedSchema = z.object({ created: z.boolean(), item: liveItemRowSchema });
const organizedSchema = z.object({ items: z.array(itemSummarySchema) });
const changedSchema = z.object({
  addressHeld: z.array(z.string()),
  changed: z.array(z.string()),
  missing: z.array(z.string()),
});
const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
const count = z.number().int().nonnegative();
const importLandedSchema = z.object({ added: count, alreadySaved: count, unreadable: count });
const purgedSchema = z.object({ missing: z.array(z.string()), purged: z.array(z.string()) });
const sweepAskedSchema = z.object({ items: count });

// an item's body in reading order, read where it lives: the seed the cell kept, or its note, which
// is read outside any transaction since a cold note's load calls back into the cell
const bodyOf = async (context: CellContext, itemId: string) => {
  const held = context.read((db) => heldBody(db, itemId));
  if (held === null) {
    throw new NotFoundError();
  }
  if (held.kind === "seed") {
    return held.blocks;
  }
  const read = await context.notes(itemId).read();
  return noteBlocksSchema.parse(read.blocks);
};

// the cloud's reading of a link a write left waiting: a built-in agent's turn holds it until the
// turn seals, so the agent never reads, within its turn, a page it saved
const askReading = (scope: ItemScope, actor: CellActor, item: LiveItemRow): void => {
  if (actor.kind === "agent") {
    askFillAfterTurn(scope, item, actor);
  } else {
    askFill(scope, item);
  }
};

export const libraryRouter = os.router({
  agent: agentRouter,
  folders: {
    write: os.folders.write.handler(({ context, input }) =>
      context.landApart({ answer: foldersWrittenSchema, opId: input.opId }, (scope) => ({
        folders: writeFolders(scope, input.ops),
        seq: libraryHead(scope.db),
      })),
    ),
  },
  guide: os.guide.handler(() => ({ markdown: DIALECT_SPEC })),
  imports: {
    land: os.imports.land.handler(({ context, input }) => {
      const { library } = context;
      return answer(
        library.land(IMPORT_ACTOR, { answer: importLandedSchema, opId: input.opId }, (scope) =>
          landImported(scope, library.ids, input.items),
        ),
      );
    }),
    named: os.imports.named.handler(({ context, input }) =>
      context.read((db) => namedFiles(db, input.shas)),
    ),
    settle: os.imports.settle.handler(({ context, input }) => {
      const { ids } = context.library;
      return {
        notes: context.read((db) => input.notes.map((note) => settleNote(db, note, ids.item))),
      };
    }),
  },
  items: {
    create: os.items.create.handler(({ context, input }) =>
      context.land({ answer: landedSchema, opId: input.opId }, (scope) => ({
        item: landNew(scope, { blocks: input.blocks, fields: noteFields(input), id: input.id }),
      })),
    ),
    createFile: os.items.createFile.handler(({ context, input }) =>
      context.land({ answer: landedSchema, opId: input.opId }, (scope) => ({
        item: createFile(scope, input),
      })),
    ),
    createNote: os.items.createNote.handler(({ context, input }) => {
      const { ids } = context.library;
      return context.land({ answer: landedSchema, opId: input.opId }, (scope) => ({
        item: createNote(scope, cellCodec(scope.db, ids), ids, input),
      }));
    }),
    delete: os.items.delete.handler(({ context, input }) => {
      const { changed, missing } = context.land(
        { answer: changedSchema, opId: input.opId },
        (scope) => setDeleted(scope, { deleted: true, ids: input.ids }),
      );
      return { deleted: changed, missing };
    }),
    edit: os.items.edit.handler(async ({ context, input }) =>
      answer(await editByNote(context, input)),
    ),
    get: os.items.get.handler(async ({ context, input }) => {
      const blocks = await bodyOf(context, input.id);
      return context.read((db) => itemWhole(db, input.id, blocks));
    }),
    list: os.items.list.handler(({ context, input }) =>
      context.readListing((listing, db) => listItems(db, listing, input)),
    ),
    organize: os.items.organize.handler(({ context, input }) =>
      context.land({ answer: organizedSchema, opId: input.opId }, (scope) => ({
        items: landedSummaries(scope.db, organizeItems(scope, context.library.ids, input)),
      })),
    ),
    purge: os.items.purge.handler(({ context, input }) =>
      context.landApart({ answer: purgedSchema, opId: input.opId }, (scope) =>
        purgeItems(scope, input.ids),
      ),
    ),
    read: os.items.read.handler(async ({ context, input }) => {
      const blocks = await bodyOf(context, input.id);
      return context.read((db) =>
        readItemView(db, cellCodec(db, context.library.ids), input, blocks),
      );
    }),
    // the page is read again by the cloud: the item waits, pending, as a stub saved to read later
    // does
    refresh: os.items.refresh.handler(({ context, input }) =>
      context.land({ answer: landedSchema, opId: input.opId }, (scope, actor) => {
        const item = refreshItem(scope, input.id);
        askReading(scope, actor, item);
        return { item };
      }),
    ),
    restore: os.items.restore.handler(({ context, input }) => {
      const { addressHeld, changed, missing } = context.land(
        { answer: changedSchema, opId: input.opId },
        (scope, actor) => {
          const restored = setDeleted(scope, { deleted: false, ids: input.ids });
          for (const item of restored.landed) {
            askReading(scope, actor, item);
          }
          return restored;
        },
      );
      return { addressHeld, missing, restored: changed };
    }),
    row: os.items.row.handler(({ context, input }) => context.read((db) => itemRow(db, input.id))),
    // a page read into an item whose note writes its body lands its article by the note
    save: os.items.save.handler(async ({ context, input }) => {
      const { library } = context;
      const saved = await landArticle(context.notes, input.article, (inNote) =>
        library.land(context.actor(), { answer: savedSchema, opId: input.opId }, (scope) => {
          const page = savePage(scope, cellCodec(scope.db, library.ids), {
            ...input,
            articleInNote: inNote !== null,
          });
          if (inNote !== null) {
            landProjection(scope, inNote.itemId, inNote.projection);
          }
          return page;
        }),
      );
      return answer(saved);
    }),
    // a stub saved to read later lands `pending`; the cloud's read of its page follows the commit
    saveLink: os.items.saveLink.handler(({ context, input }) => {
      const { ids } = context.library;
      return context.land({ answer: savedSchema, opId: input.opId }, (scope, actor) => {
        const saved = saveLink(scope, cellCodec(scope.db, ids), ids, input);
        if (saved.created) {
          askReading(scope, actor, saved.item);
        }
        return saved;
      });
    }),
    // the items the scope lists as it is asked, left as lots for the alarm to land
    sweep: os.items.sweep.handler(({ context, input }) => {
      const itemIds = context.readListing((listing) => sweptIds(listing, input));
      return context.landApart({ answer: sweepAskedSchema, opId: input.opId }, ({ db, now }) =>
        askSweep(db, now, context.library.ids.sweep(), input.verb, itemIds),
      );
    }),
  },
  listing: {
    page: os.listing.page.handler(({ context, input }) =>
      context.readListing((listing, db) => listingPage(db, listing, input)),
    ),
    scopes: os.listing.scopes.handler(({ context }) =>
      context.readListing((listing) => listing.scopes()),
    ),
    titles: os.listing.titles.handler(({ context }) =>
      context.readListing((listing) => listing.titles()),
    ),
  },
  organize: {
    // the rail's own folders and tags; the row's answer leaves a folder's order key out
    outline: os.organize.outline.handler(({ context }) =>
      context.readListing((listing) => {
        const { folders, tags } = listing.scopes();
        return { folders, tags };
      }),
    ),
  },
  search: os.search.handler(({ context, input }) =>
    context.readListing((listing, db) => searchItems(db, listing, input)),
  ),
  write: os.write.handler(({ context, input }) =>
    context.land({ answer: landedSchema, opId: input.opId }, (scope) => ({
      item: landPropertyOps(scope, input),
    })),
  ),
});
