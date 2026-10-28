// The library's procedures, implemented once over the account's cell: `/v1/rpc/library` serves
// them to the apps (`./library-rpc`) and the connector to every agent, each call with the
// principal the Worker verified. Every write lands through the engine in one transaction, joins
// its principal's change set, and is settled after it commits (the sockets told, the alarm set);
// every refusal answers as the error its row declares (`@repo/contract/cloud/v1-errors`).

import {
  AccountGoneError,
  AgentUnavailableError,
  AlreadyUndoneError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
} from "@repo/contract/cloud/v1/errors";
import { liveItemRowSchema } from "@repo/contract/cloud/library/library-wire";
import { ORPCError, implement } from "@orpc/server";
import { z } from "zod";

import { libraryTools } from "../connector/library-tools";
import { cellCodec } from "./cell-codec";
import { writeFolders } from "./cell-folders";
import {
  addHighlight,
  blankFields,
  createFile,
  createNote,
  editItem,
  landNew,
  organizeItems,
  refreshItem,
  setDeleted,
} from "./cell-items";
import type { LiveItemRow } from "./cell-landing";
import {
  isoOf,
  listHighlights,
  listHistory,
  listItems,
  outlineOf,
  readItemView,
  searchItems,
  summaryOf,
} from "./cell-reads";
import type { CellRefusal, CellResult } from "./cell-refusal";
import { saveLink, savePage } from "./cell-saves";
import { libraryHead } from "./cell-sync";
import { deleteThread, listThreads, threadEvents } from "./cell-threads";
import { landedSchema } from "./library-engine";
import type { LibraryEngine } from "./library-engine";
import { cellActorOf } from "./library-principal";
import type { Principal } from "./library-principal";

export interface CellContext {
  readonly principal: Principal;
  readonly library: LibraryEngine;
  // what follows a committed write: the sockets told the new head, the alarm set
  readonly settle: <T>(result: CellResult<T>) => Promise<CellResult<T>>;
}

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
      return new EditRefusedError({ data: refusal.refusal });
    }
    case "bad-cursor": {
      return new ORPCError("BAD_REQUEST", {
        message: "That cursor isn't one this library answered with.",
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

const savedSchema = z.object({ folded: z.boolean(), item: liveItemRowSchema });
const editedSchema = z.object({ dropped: z.array(z.string()), seq: z.number() });
const organizedSchema = z.object({ items: z.array(liveItemRowSchema) });
const changedSchema = z.object({ changed: z.array(z.string()), missing: z.array(z.string()) });
const highlightedSchema = z.object({
  createdAt: z.number(),
  id: z.string(),
  item: liveItemRowSchema,
  placed: z.boolean(),
});
const headSchema = z.object({ seq: z.number() });
const deletedSchema = z.object({ deleted: z.literal(true) });

// the agent arrives with Managed Agents: until a cell can start one, every ask of it is refused as
// a Worker without the key refuses it, and nothing is charged
const agentUnavailable = (): never => {
  throw new AgentUnavailableError();
};

const DAY_MS = 24 * 60 * 60 * 1000;

const summaryOfRow = (row: LiveItemRow) => summaryOf(row, "concise");

const os = implement(libraryTools).$context<CellContext>();

export const libraryRouter = os.router({
  agent: {
    cancel: os.agent.cancel.handler(agentUnavailable),
    delete: os.agent.delete.handler(({ context, input }) =>
      committed(
        context,
        context.library.landApart({ answer: deletedSchema, opId: input.opId }, (scope) => {
          deleteThread(scope, input.threadId);
          return { deleted: true as const };
        }),
      ),
    ),
    events: os.agent.events.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          threadEvents(sql, { ...input, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    list: os.agent.list.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          listThreads(sql, { cursor: input.cursor, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    respond: os.agent.respond.handler(agentUnavailable),
    send: os.agent.send.handler(agentUnavailable),
    setEnabled: os.agent.setEnabled.handler(agentUnavailable),
    // off, with no turns left today: no agent can run in this cell
    status: os.agent.status.handler(() => {
      const now = Date.now();
      return { enabled: false, resetsAt: now - (now % DAY_MS) + DAY_MS, turnsLeft: 0 };
    }),
  },
  annotations: {
    add: os.annotations.add.handler(async ({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      const added = await committed(
        context,
        library.land(actor, { answer: highlightedSchema, opId: input.opId }, (scope) =>
          addHighlight(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        ),
      );
      return {
        highlight: {
          createdAt: isoOf(added.createdAt * 1000),
          id: added.id,
          itemId: input.itemId,
          itemTitle: added.item.card.title,
          placed: added.placed,
          quote: input.quote,
          replies: [],
          text: input.note ?? "",
        },
      };
    }),
    list: os.annotations.list.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          listHighlights(sql, { ...input, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
  },
  folders: {
    write: os.folders.write.handler(({ context, input }) =>
      committed(
        context,
        context.library.landApart({ answer: headSchema, opId: input.opId }, (scope) => {
          writeFolders(scope, input.ops);
          return { seq: libraryHead(scope.storage) };
        }),
      ),
    ),
  },
  history: {
    list: os.history.list.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          listHistory(sql, { ...input, limit: input.limit ?? PAGE_DEFAULT }),
        ),
      ),
    ),
    revision: os.history.revision.handler(({ context, input }) => {
      const revision = answer(context.library.revision(input.itemId, input.rev));
      if (revision === null) {
        throw new NotFoundError();
      }
      return revision;
    }),
    undo: os.history.undo.handler(({ context, input }) =>
      committed(context, context.library.undo(cellActorOf(context.principal), input)),
    ),
  },
  items: {
    create: os.items.create.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      return committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: landNew(scope, actor, {
            blocks: input.blocks,
            fields: {
              ...blankFields(scope.now),
              folderId: input.folderId,
              savedAt: input.savedAt,
              tags: input.tags,
              title: input.title,
            },
            id: input.id,
          }),
        })),
      );
    }),
    createFile: os.items.createFile.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      return committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: createFile(scope, actor, input),
        })),
      );
    }),
    createNote: os.items.createNote.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      return committed(
        context,
        library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: createNote(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        })),
      );
    }),
    delete: os.items.delete.handler(async ({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { changed, missing } = await committed(
        context,
        context.library.land(actor, { answer: changedSchema, opId: input.opId }, (scope) =>
          setDeleted(scope, actor, { deleted: true, ids: input.ids }),
        ),
      );
      return { deleted: changed, missing };
    }),
    edit: os.items.edit.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      return committed(
        context,
        library.land(actor, { answer: editedSchema, opId: input.opId }, (scope) =>
          editItem(scope, actor, cellCodec(scope.storage, library.ids), input),
        ),
      );
    }),
    list: os.items.list.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          listItems(sql, {
            ...input,
            limit: input.limit ?? PAGE_DEFAULT,
            responseFormat: input.responseFormat ?? "concise",
          }),
        ),
      ),
    ),
    organize: os.items.organize.handler(async ({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      const { items } = await committed(
        context,
        library.land(actor, { answer: organizedSchema, opId: input.opId }, (scope) => ({
          items: organizeItems(scope, actor, library.ids, input),
        })),
      );
      return { items: items.map(summaryOfRow) };
    }),
    purge: os.items.purge.handler(({ context, input }) =>
      committed(context, context.library.purgeItems(input)),
    ),
    read: os.items.read.handler(({ context, input }) =>
      answer(
        context.library.read((sql) =>
          readItemView(sql, cellCodec(sql, context.library.ids), {
            ...input,
            responseFormat: input.responseFormat ?? "concise",
          }),
        ),
      ),
    ),
    // the page is read again by the cloud: the item waits, pending, as a stub saved to read later
    // does
    refresh: os.items.refresh.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      return committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: refreshItem(scope, actor, input.id),
        })),
      );
    }),
    restore: os.items.restore.handler(async ({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { changed, missing } = await committed(
        context,
        context.library.land(actor, { answer: changedSchema, opId: input.opId }, (scope) =>
          setDeleted(scope, actor, { deleted: false, ids: input.ids }),
        ),
      );
      return { missing, restored: changed };
    }),
    save: os.items.save.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      return committed(
        context,
        library.land(actor, { answer: savedSchema, opId: input.opId }, (scope) =>
          savePage(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        ),
      );
    }),
    // a stub saved to read later lands `pending`; the cloud's read of its page follows the commit
    saveLink: os.items.saveLink.handler(({ context, input }) => {
      const actor = cellActorOf(context.principal);
      const { library } = context;
      return committed(
        context,
        library.land(actor, { answer: savedSchema, opId: input.opId }, (scope) =>
          saveLink(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        ),
      );
    }),
  },
  organize: {
    outline: os.organize.outline.handler(({ context }) =>
      answer(context.library.read((sql) => outlineOf(sql))),
    ),
  },
  search: os.search.handler(({ context, input }) =>
    answer(
      context.library.read((sql) =>
        searchItems(sql, {
          ...input,
          limit: input.limit ?? PAGE_DEFAULT,
          responseFormat: input.responseFormat ?? "concise",
        }),
      ),
    ),
  ),
  sync: {
    bodies: os.sync.bodies.handler(({ context, input }) =>
      answer(context.library.bodies(input.ids)),
    ),
    pull: os.sync.pull.handler(({ context, input }) => answer(context.library.pull(input))),
  },
  write: os.write.handler(({ context, input }) =>
    committed(context, context.library.write(cellActorOf(context.principal), input)),
  ),
});
