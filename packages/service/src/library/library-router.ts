// The library's procedures, implemented once over the account's cell: `/v1/rpc/library` serves
// them to the apps (`./library-rpc`), the connector serves its tools to assistants, and the cell
// runs those for the built-in agent (`../agent/agent-tools`), each call by the actor its principal
// resolves to. Every write lands through the engine in one transaction, joins its actor's change
// set, and is settled after it commits (the sockets told, the alarm set); every refusal answers as
// the error its row declares (`@repo/contract/v1/errors`). The built-in agent's turns are
// `../agent/agent-turns`'.

import {
  AccountGoneError,
  AgentBudgetError,
  AgentUnavailableError,
  AlreadyUndoneError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
} from "@repo/contract/v1/errors";
import {
  folderRowSchema,
  importJobSchema,
  liveItemRowSchema,
} from "@repo/contract/library/library-wire";
import { ORPCError, implement } from "@orpc/server";
import { noteFields } from "@repo/contract/library/item-makes";
import { z } from "zod";

import { setAgentEnabled } from "../agent/agent-switch";
import { errorFields } from "../log";
import {
  agentStatus,
  cancelTurn,
  deleteAgentThread,
  respondToAgent,
  sendToAgent,
} from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import { libraryTools } from "../connector/library-tools";
import { noteBlocksSchema } from "../note/note-wire";
import type { NoteReach, TurnUndone } from "../note/note-wire";
import { articleThenLand } from "./article-landing";
import { heldBody } from "./cell-body";
import { cellCodec } from "./cell-codec";
import { editByNote } from "./cell-edits";
import { askFill, askFillAfterTurn } from "./cell-fills";
import { writeFolders } from "./cell-folders";
import { importJobView, latestImportJob, readImportJob } from "./cell-import-jobs";
import { cancelImport, startImport } from "./cell-imports";
import {
  createFile,
  createNote,
  landNew,
  organizeItems,
  refreshItem,
  setDeleted,
} from "./cell-items";
import { bodyInNote, landProjection } from "./cell-notes";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { itemRow, itemWhole, listingPage } from "./cell-listing";
import {
  listChangeSets,
  listItems,
  outlineOf,
  readItemView,
  searchItems,
  summaryOf,
} from "./cell-reads";
import type { CellRefusal, CellResult } from "./cell-refusal";
import { pageForNote, saveLink, savePage } from "./cell-saves";
import { mergeTurnUndos, planUndo } from "./cell-undo";
import type { CellActor } from "./cell-actor";
import { listThreads, threadEvents } from "./cell-threads";
import { landedSchema, libraryHead } from "./library-engine";
import { readLiveItem } from "./library-queries";
import type { LibraryEngine } from "./library-engine";
import { readLibraryRules, writeLibraryRules } from "./library-rules";

export interface CellContext {
  // whom this call's writes are by, read at the moment a write lands: the built-in agent's is its
  // turn, and refused once that turn is no longer open
  readonly actor: () => CellActor;
  readonly library: LibraryEngine;
  // the built-in agent's turns, which `library.agent.*` asks of
  readonly agent: AgentCell;
  // what follows a committed write: the sockets told what it moved, the alarm set
  readonly settle: <T>(result: CellResult<T>) => Promise<CellResult<T>>;
  // each item's note, which every read and write of a body opened there goes through
  readonly notes: NoteReach;
}

const EDIT_UNSTORABLE = "That edit holds a block the library can't keep.";

const refusalError = (refusal: CellRefusal): Error => {
  switch (refusal.kind) {
    case "gone": {
      return new AccountGoneError();
    }
    case "not-found": {
      return new NotFoundError();
    }
    case "conflict": {
      return new ConflictError({ data: { current: [...refusal.current] } });
    }
    case "url-held": {
      return new ConflictError({
        data: { current: [{ itemId: refusal.itemId, kind: "item", seq: refusal.seq }] },
        message: "Another item in your library already holds this link.",
      });
    }
    case "too-large": {
      return new PayloadTooLargeError();
    }
    case "quota": {
      return new QuotaError({ data: { bytesCap: refusal.bytesCap, bytesUsed: refusal.bytesUsed } });
    }
    case "blob-missing": {
      return new BlobMissingError({ data: { shas: [...refusal.shas] } });
    }
    case "already-undone": {
      return new AlreadyUndoneError({
        data: { changeSetId: refusal.changeSetId, undoneBy: refusal.undoneBy },
      });
    }
    case "edit-refused": {
      return refusal.refusal.reason === "unstorable"
        ? new EditRefusedError({ data: refusal.refusal, message: EDIT_UNSTORABLE })
        : new EditRefusedError({ data: refusal.refusal });
    }
    case "bad-cursor": {
      return new ORPCError("BAD_REQUEST", {
        message: "That cursor isn't one this library answered with.",
      });
    }
    case "agent-unavailable": {
      return new AgentUnavailableError();
    }
    case "agent-budget": {
      return new AgentBudgetError({ data: { resetsAt: refusal.resetsAt } });
    }
    // a write that met a body gone to its note twice over: a fault to send again
    case "note-opened": {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "That item just opened elsewhere. Try again.",
      });
    }
    // no default
  }
};

// a result's value, or its refusal thrown as the error its procedure declares
const answer = <T>(result: CellResult<T>): T => {
  if (result.ok) {
    return result.value;
  }
  throw refusalError(result.refusal);
};

const committed = async <T>(context: CellContext, result: CellResult<T>): Promise<T> =>
  answer(await context.settle(result));

// how a list or a read answers unless asked
const PAGE_DEFAULT = 50;

const savedSchema = z.object({ created: z.boolean(), item: liveItemRowSchema });
const organizedSchema = z.object({ items: z.array(liveItemRowSchema) });
const changedSchema = z.object({
  addressHeld: z.array(z.string()),
  changed: z.array(z.string()),
  missing: z.array(z.string()),
});
const foldersWrittenSchema = z.object({ folders: z.array(folderRowSchema), seq: z.number() });
const importAnswer = z.object({ job: importJobSchema });
const rulesAnswer = z.object({ rules: z.string() });

const summaryOfRow = (row: LiveItemRow) => summaryOf(row, "concise");

// an item's body in reading order, read where it lives: the seed the cell kept, or its note, which
// is read outside any transaction since a cold note's load calls back into the cell
const bodyOf = async (context: CellContext, itemId: string) => {
  const held = answer(context.library.read((storage) => heldBody(storage.db, itemId)));
  if (held === null) {
    throw new NotFoundError();
  }
  if (held.kind === "seed") {
    return held.blocks;
  }
  const read = await context.notes(itemId).read();
  return noteBlocksSchema.parse(read.blocks);
};

// Deleted or back, told to each changed item's note once the write committed, so its sockets turn
// read-only or open again writable; a note that misses it meets the item's place on its next open
const tellNotesDeleted = async (
  context: CellContext,
  ids: readonly string[],
  deleted: boolean,
): Promise<void> => {
  const inNotes = answer(
    context.library.read((storage) =>
      ids.filter((id) => {
        const item = readLiveItem(storage.db, id);
        return item !== null && bodyInNote(item);
      }),
    ),
  );
  for (const id of inNotes) {
    try {
      await context.notes(id).setDeleted(deleted);
    } catch (error) {
      console.warn({ deleted, event: "note-deleted-unsent", ...errorFields(error) });
    }
  }
};

// the cloud's reading of a link a write left waiting: a built-in agent's turn holds it until the
// turn seals, so the agent never reads, within its turn, a page it saved
const askReading = (scope: LandingScope, actor: CellActor, item: LiveItemRow): void => {
  if (actor.kind === "agent") {
    askFillAfterTurn(scope, item, scope.set().id);
  } else {
    askFill(scope, item);
  }
};

const os = implement(libraryTools).$context<CellContext>();

export const libraryRouter = os.router({
  agent: {
    cancel: os.agent.cancel.handler(
      async ({ context, input }) =>
        await committed(context, await cancelTurn(context.agent, input)),
    ),
    delete: os.agent.delete.handler(
      async ({ context, input }) =>
        await committed(context, await deleteAgentThread(context.agent, input)),
    ),
    events: os.agent.events.handler(({ context, input }) =>
      answer(
        context.library.read((storage) =>
          threadEvents(storage.db, { ...input, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    list: os.agent.list.handler(({ context, input }) =>
      answer(
        context.library.read((storage) =>
          listThreads(storage.db, { cursor: input.cursor, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    respond: os.agent.respond.handler(
      async ({ context, input }) =>
        await committed(context, await respondToAgent(context.agent, input)),
    ),
    send: os.agent.send.handler(
      async ({ context, input }) =>
        await committed(context, await sendToAgent(context.agent, input)),
    ),
    rules: os.agent.rules.handler(({ context }) =>
      answer(context.library.read((storage) => ({ rules: readLibraryRules(storage.db) }))),
    ),
    setEnabled: os.agent.setEnabled.handler(
      async ({ context, input }) => await committed(context, setAgentEnabled(context.agent, input)),
    ),
    // a meta row of the library's, joining no change set: rules are no item's
    setRules: os.agent.setRules.handler(
      async ({ context, input }) =>
        await committed(
          context,
          context.library.landApart({ answer: rulesAnswer, opId: input.opId }, (scope) => {
            writeLibraryRules(scope.storage.db, input.rules);
            return { rules: input.rules };
          }),
        ),
    ),
    // whether it is on, and what is left of the day's allowance
    status: os.agent.status.handler(({ context }) => answer(agentStatus(context.agent))),
  },
  folders: {
    write: os.folders.write.handler(
      async ({ context, input }) =>
        await committed(
          context,
          context.library.landApart(
            { answer: foldersWrittenSchema, opId: input.opId },
            (scope) => ({
              folders: writeFolders(scope, input.ops),
              seq: libraryHead(scope.storage.db),
            }),
          ),
        ),
    ),
  },
  history: {
    list: os.history.list.handler(({ context, input }) =>
      answer(
        context.library.read((storage) =>
          listChangeSets(storage.db, { ...input, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    // the notes an agent's sets wrote in undo first, outside any transaction, each under the
    // undo's own set; the write then lands what they answered beside the fields
    undo: os.history.undo.handler(async ({ context, input }) => {
      const { library } = context;
      const plan = answer(library.read((storage) => planUndo(storage, input.changeSetIds)));
      const undoSetId = library.ids.changeSet();
      const answers: { itemId: string; undone: TurnUndone }[] = [];
      for (const { itemId, setId } of plan) {
        answers.push({ itemId, undone: await context.notes(itemId).undoTurn(setId, undoSetId) });
      }
      return await committed(
        context,
        library.undo(context.actor(), input, { notes: mergeTurnUndos(answers), undoSetId }),
      );
    }),
  },
  imports: {
    cancel: os.imports.cancel.handler(
      async ({ context, input }) =>
        await committed(
          context,
          context.library.landApart({ answer: importAnswer, opId: input.opId }, (scope) => ({
            job: importJobView(cancelImport(scope, input.id)),
          })),
        ),
    ),
    get: os.imports.get.handler(({ context, input }) => {
      const job = answer(context.library.read((storage) => readImportJob(storage.db, input.id)));
      if (job === null) {
        throw new NotFoundError();
      }
      return { job: importJobView(job) };
    }),
    latest: os.imports.latest.handler(({ context }) => {
      const job = answer(context.library.read((storage) => latestImportJob(storage.db)));
      return { job: job === null ? null : importJobView(job) };
    }),
    start: os.imports.start.handler(async ({ context, input }) => {
      const { library } = context;
      return await committed(
        context,
        library.landApart({ answer: importAnswer, opId: input.opId }, (scope) => ({
          job: importJobView(startImport(scope, library.ids, input)),
        })),
      );
    }),
  },
  items: {
    create: os.items.create.handler(async ({ context, input }) => {
      const actor = context.actor();
      return await committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: landNew(scope, {
            blocks: input.blocks,
            fields: noteFields(input),
            id: input.id,
          }),
        })),
      );
    }),
    createFile: os.items.createFile.handler(async ({ context, input }) => {
      const actor = context.actor();
      return await committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: createFile(scope, input),
        })),
      );
    }),
    createNote: os.items.createNote.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      return await committed(
        context,
        library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: createNote(scope, cellCodec(scope.storage.db, library.ids), library.ids, input),
        })),
      );
    }),
    delete: os.items.delete.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { changed, missing } = await committed(
        context,
        context.library.land(actor, { answer: changedSchema, opId: input.opId }, (scope) =>
          setDeleted(scope, { deleted: true, ids: input.ids }),
        ),
      );
      await tellNotesDeleted(context, changed, true);
      return { deleted: changed, missing };
    }),
    edit: os.items.edit.handler(
      async ({ context, input }) =>
        await committed(
          context,
          await editByNote(
            { actor: context.actor, library: context.library, notes: context.notes },
            input,
          ),
        ),
    ),
    get: os.items.get.handler(async ({ context, input }) => {
      const blocks = await bodyOf(context, input.id);
      return answer(context.library.read((storage) => itemWhole(storage, input.id, blocks)));
    }),
    list: os.items.list.handler(({ context, input }) =>
      answer(
        context.library.readListing((listing, storage) =>
          listItems(storage.db, listing, {
            ...input,
            limit: input.limit ?? PAGE_DEFAULT,
            responseFormat: input.responseFormat ?? "concise",
          }),
        ),
      ),
    ),
    organize: os.items.organize.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      const { items } = await committed(
        context,
        library.land(actor, { answer: organizedSchema, opId: input.opId }, (scope) => ({
          items: organizeItems(scope, library.ids, input),
        })),
      );
      return { items: items.map(summaryOfRow) };
    }),
    purge: os.items.purge.handler(
      async ({ context, input }) => await committed(context, context.library.purgeItems(input)),
    ),
    read: os.items.read.handler(async ({ context, input }) => {
      const blocks = await bodyOf(context, input.id);
      return answer(
        context.library.read((storage) =>
          readItemView(
            storage,
            cellCodec(storage.db, context.library.ids),
            { ...input, responseFormat: input.responseFormat ?? "concise" },
            blocks,
          ),
        ),
      );
    }),
    // the page is read again by the cloud: the item waits, pending, as a stub saved to read later
    // does
    refresh: os.items.refresh.handler(async ({ context, input }) => {
      const actor = context.actor();
      return await committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => {
          const item = refreshItem(scope, input.id);
          askReading(scope, actor, item);
          return { item };
        }),
      );
    }),
    restore: os.items.restore.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { addressHeld, changed, missing } = await committed(
        context,
        context.library.land(actor, { answer: changedSchema, opId: input.opId }, (scope) => {
          const restored = setDeleted(scope, { deleted: false, ids: input.ids });
          for (const item of restored.landed) {
            askReading(scope, actor, item);
          }
          return restored;
        }),
      );
      await tellNotesDeleted(context, changed, false);
      return { addressHeld, missing, restored: changed };
    }),
    row: os.items.row.handler(({ context, input }) =>
      answer(context.library.read((storage) => itemRow(storage, input.id))),
    ),
    // a page read into an item whose note opened puts its article in the note first, once per op
    save: os.items.save.handler(async ({ context, input }) => {
      const { library } = context;
      const saved = await articleThenLand(context.notes, {
        land: (inNote) =>
          library.land(context.actor(), { answer: savedSchema, opId: input.opId }, (scope) => {
            const page = savePage(scope, cellCodec(scope.storage.db, library.ids), {
              ...input,
              articleInNote: inNote !== null,
            });
            if (inNote !== null) {
              landProjection(scope, inNote.itemId, inNote.projection);
            }
            return page;
          }),
        target: () => {
          const item = answer(library.read((storage) => pageForNote({ storage }, input.url)));
          return item === null
            ? null
            : { article: input.article, itemId: item.id, onceId: `save:${input.opId}` };
        },
      });
      return await committed(context, saved);
    }),
    // a stub saved to read later lands `pending`; the cloud's read of its page follows the commit
    saveLink: os.items.saveLink.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      return await committed(
        context,
        library.land(actor, { answer: savedSchema, opId: input.opId }, (scope) => {
          const saved = saveLink(
            scope,
            cellCodec(scope.storage.db, library.ids),
            library.ids,
            input,
          );
          if (saved.created) {
            askReading(scope, actor, saved.item);
          }
          return saved;
        }),
      );
    }),
  },
  listing: {
    page: os.listing.page.handler(({ context, input }) =>
      answer(
        context.library.readListing((listing, storage) => listingPage(storage, listing, input)),
      ),
    ),
    scopes: os.listing.scopes.handler(({ context }) =>
      answer(context.library.readListing((listing) => listing.scopes())),
    ),
    titles: os.listing.titles.handler(({ context }) =>
      answer(context.library.readListing((listing) => listing.titles())),
    ),
  },
  organize: {
    outline: os.organize.outline.handler(({ context }) =>
      answer(context.library.readListing((listing, storage) => outlineOf(storage.db, listing))),
    ),
  },
  search: os.search.handler(({ context, input }) =>
    answer(
      context.library.readListing((listing, storage) =>
        searchItems(storage, listing, {
          ...input,
          limit: input.limit ?? PAGE_DEFAULT,
          responseFormat: input.responseFormat ?? "concise",
        }),
      ),
    ),
  ),
  write: os.write.handler(
    async ({ context, input }) =>
      await committed(context, context.library.write(context.actor(), input)),
  ),
});
