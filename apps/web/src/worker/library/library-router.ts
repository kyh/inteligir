// The library's procedures, implemented once over the account's cell: `/v1/rpc/library` serves
// them to the apps (`./library-rpc`), the connector serves its tools to assistants, and the cell
// runs those for the built-in agent (`../agent/agent-tools`), each call by the actor its principal
// resolves to. Every write lands through the engine in one transaction, joins its actor's change
// set, and is settled after it commits (the sockets told, the alarm set); every refusal answers as
// the error its row declares (`@repo/contract/cloud/v1/errors`). The built-in agent's turns are
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
} from "@repo/contract/cloud/v1/errors";
import { importJobSchema, liveItemRowSchema } from "@repo/contract/cloud/library/library-wire";
import { ORPCError, implement } from "@orpc/server";
import { noteFields } from "@repo/notes/library/item-makes";
import { z } from "zod";

import { setAgentEnabled } from "../agent/agent-switch";
import {
  agentStatus,
  cancelTurn,
  deleteAgentThread,
  respondToAgent,
  sendToAgent,
} from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import { libraryTools } from "../connector/library-tools";
import { cellCodec } from "./cell-codec";
import { askFill, askFillAfterTurn } from "./cell-fills";
import { writeFolders } from "./cell-folders";
import { importJobView, latestImportJob, readImportJob } from "./cell-import-jobs";
import { cancelImport, startImport } from "./cell-imports";
import {
  addHighlight,
  createFile,
  createNote,
  editItem,
  landNew,
  organizeItems,
  refreshItem,
  setDeleted,
} from "./cell-items";
import type { LandingScope, LiveItemRow } from "./cell-landing";
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
import type { CellActor } from "./cell-actor";
import { listThreads, threadEvents } from "./cell-threads";
import { landedSchema } from "./library-engine";
import type { LibraryEngine } from "./library-engine";
import { readLibraryRules, writeLibraryRules } from "./library-rules";

export interface CellContext {
  // whom this call's writes are by, read at the moment a write lands: the built-in agent's is its
  // turn, and refused once that turn is no longer open
  readonly actor: () => CellActor;
  readonly library: LibraryEngine;
  // the built-in agent's turns, which `library.agent.*` asks of
  readonly agent: AgentCell;
  // what follows a committed write: the sockets told the new head, the alarm set
  readonly settle: <T>(result: CellResult<T>) => Promise<CellResult<T>>;
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
const editedSchema = z.object({ dropped: z.array(z.string()), seq: z.number() });
const organizedSchema = z.object({ items: z.array(liveItemRowSchema) });
const changedSchema = z.object({
  addressHeld: z.array(z.string()),
  changed: z.array(z.string()),
  missing: z.array(z.string()),
});
const highlightedSchema = z.object({
  createdAt: z.number(),
  id: z.string(),
  item: liveItemRowSchema,
  placed: z.boolean(),
});
const headSchema = z.object({ seq: z.number() });
const importAnswer = z.object({ job: importJobSchema });
const rulesAnswer = z.object({ rules: z.string() });

const summaryOfRow = (row: LiveItemRow) => summaryOf(row, "concise");

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
    respond: os.agent.respond.handler(
      async ({ context, input }) =>
        await committed(context, await respondToAgent(context.agent, input)),
    ),
    send: os.agent.send.handler(
      async ({ context, input }) =>
        await committed(context, await sendToAgent(context.agent, input)),
    ),
    rules: os.agent.rules.handler(({ context }) =>
      answer(context.library.read((sql) => ({ rules: readLibraryRules(sql) }))),
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
            writeLibraryRules(scope.storage, input.rules);
            return { rules: input.rules };
          }),
        ),
    ),
    // whether it is on, and what is left of the day's allowance
    status: os.agent.status.handler(({ context }) => answer(agentStatus(context.agent))),
  },
  annotations: {
    add: os.annotations.add.handler(async ({ context, input }) => {
      const actor = context.actor();
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
    write: os.folders.write.handler(
      async ({ context, input }) =>
        await committed(
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
    undo: os.history.undo.handler(
      async ({ context, input }) =>
        await committed(context, context.library.undo(context.actor(), input)),
    ),
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
      const job = answer(context.library.read((sql) => readImportJob(sql, input.id)));
      if (job === null) {
        throw new NotFoundError();
      }
      return { job: importJobView(job) };
    }),
    latest: os.imports.latest.handler(({ context }) => {
      const job = answer(context.library.read((sql) => latestImportJob(sql)));
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
          item: landNew(scope, actor, {
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
          item: createFile(scope, actor, input),
        })),
      );
    }),
    createNote: os.items.createNote.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      return await committed(
        context,
        library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
          item: createNote(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        })),
      );
    }),
    delete: os.items.delete.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { changed, missing } = await committed(
        context,
        context.library.land(actor, { answer: changedSchema, opId: input.opId }, (scope) =>
          setDeleted(scope, actor, { deleted: true, ids: input.ids }),
        ),
      );
      return { deleted: changed, missing };
    }),
    edit: os.items.edit.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      return await committed(
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
      const actor = context.actor();
      const { library } = context;
      const { items } = await committed(
        context,
        library.land(actor, { answer: organizedSchema, opId: input.opId }, (scope) => ({
          items: organizeItems(scope, actor, library.ids, input),
        })),
      );
      return { items: items.map(summaryOfRow) };
    }),
    purge: os.items.purge.handler(
      async ({ context, input }) => await committed(context, context.library.purgeItems(input)),
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
    refresh: os.items.refresh.handler(async ({ context, input }) => {
      const actor = context.actor();
      return await committed(
        context,
        context.library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => {
          const item = refreshItem(scope, actor, input.id);
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
          const restored = setDeleted(scope, actor, { deleted: false, ids: input.ids });
          for (const item of restored.landed) {
            askReading(scope, actor, item);
          }
          return restored;
        }),
      );
      return { addressHeld, missing, restored: changed };
    }),
    save: os.items.save.handler(async ({ context, input }) => {
      const actor = context.actor();
      const { library } = context;
      return await committed(
        context,
        library.land(actor, { answer: savedSchema, opId: input.opId }, (scope) =>
          savePage(scope, actor, cellCodec(scope.storage, library.ids), library.ids, input),
        ),
      );
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
            actor,
            cellCodec(scope.storage, library.ids),
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
  write: os.write.handler(
    async ({ context, input }) =>
      await committed(context, context.library.write(context.actor(), input)),
  ),
});
