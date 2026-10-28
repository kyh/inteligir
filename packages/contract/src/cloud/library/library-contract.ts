// The library's procedures, the account's library cell their one implementation: the apps call
// them on `/v1/rpc/library`, and every agent the same ones through the connector. A write takes an
// optional `opId`, which the cell keeps, so the outbox resending after a lost answer lands once.
// Which of these an agent sees as a tool, and how it is titled, is the Worker's to decorate
// (apps/web/src/worker/connector/library-tools.ts); nothing here names MCP or OpenAPI.

import { z } from "zod";

import { ANNOTATION_QUOTE_MAX } from "@repo/notes/annotations/store-schema";
import { libraryOpSchema } from "@repo/notes/library/block-ops";
import { ordSchema } from "@repo/notes/library/block-order";
import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import { storableBlockSchema } from "@repo/notes/library/library-nodes";

import {
  AgentBudgetError,
  AgentUnavailableError,
  AlreadyUndoneError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
  signedBase,
} from "../v1-errors";
import {
  agentViewContextSchema,
  ANNOTATION_NOTE_MAX,
  annotationOpSchema,
  BULK_ITEMS_MAX,
  changeSetSchema,
  cursorSchema,
  epochSchema,
  eventIdSchema,
  exportJobSchema,
  folderNameSchema,
  folderOpSchema,
  folderPathNames,
  highlightSchema,
  isoDate,
  idSchema,
  importJobSchema,
  itemReadSchema,
  itemSummarySchema,
  libraryChangeSchema,
  liveItemRowSchema,
  MARKDOWN_MAX,
  MESSAGE_MAX,
  newIdSchema,
  opIdSchema,
  PAGE_MAX,
  placedBlockSchema,
  responseFormatSchema,
  searchHitSchema,
  seqSchema,
  shaSchema,
  storedBlockSchema,
  THREAD_STATUSES,
  threadEventRowSchema,
  threadRowSchema,
  WRITE_OPS_MAX,
} from "./library-wire";

const FIELDS = libraryItemFieldsSchema.shape;
const opId = opIdSchema.optional();
const limit = z.number().int().min(1).max(PAGE_MAX).optional();
const cursor = cursorSchema.optional();
const responseFormat = responseFormatSchema.optional();
const ids = z.array(idSchema).min(1).max(BULK_ITEMS_MAX);

// a write that makes an item answers with its row as it landed
const landed = z.object({ item: liveItemRowSchema });
// a save of a url the library holds folds onto that item, adding what it carries
const saved = z.object({ folded: z.boolean(), item: liveItemRowSchema });

// a bulk change answers which ids it changed, and which named nothing it could change
const changedIds = z.array(idSchema);

// where an item is filed: a folder by id, or by its path of names from the top joined by `/`, made
// where it is missing, each name one a folder may hold; null is no folder. An id naming no folder
// is refused NOT_FOUND, so every row taking one declares it
const folderPathSchema = z
  .string()
  .max(1000)
  .refine(
    (path) => {
      const names = folderPathNames(path);
      return names.length > 0 && names.every((name) => folderNameSchema.validate(name));
    },
    { error: "names each folder in 1 to 255 characters" },
  );
const folderTargetSchema = z
  .union([z.strictObject({ id: idSchema }), z.strictObject({ path: folderPathSchema })])
  .nullable();

const syncContract = {
  // the change log after `cursor`, about a thousand rows a page and never ending inside one write;
  // `reset` when the library is not the one `epoch` names, so the replica starts over from 0
  pull: signedBase
    .input(z.strictObject({ cursor: seqSchema, epoch: epochSchema.nullable() }))
    .output(
      z.discriminatedUnion("kind", [
        z.object({
          changes: z.array(libraryChangeSchema),
          epoch: epochSchema,
          head: seqSchema,
          kind: z.literal("changes"),
          more: z.boolean(),
          upto: seqSchema,
        }),
        z.object({ epoch: epochSchema, kind: z.literal("reset") }),
      ]),
    ),

  // items' bodies in the order asked, about 4 MB an answer and at least one; `deferred` waits for
  // the next ask, and `gone` names items with no body to send
  bodies: signedBase.input(z.strictObject({ ids: z.array(idSchema).min(1).max(1000) })).output(
    z.object({
      bodies: z.array(
        z.object({ blocks: z.array(storedBlockSchema), id: idSchema, seq: seqSchema }),
      ),
      deferred: z.array(idSchema),
      gone: z.array(idSchema),
    }),
  ),
};

const itemsContract = {
  list: signedBase
    .input(
      z.strictObject({
        cursor,
        folderId: idSchema.optional(),
        kind: FIELDS.kind.optional(),
        limit,
        pinned: z.boolean().optional(),
        responseFormat,
        sort: z.enum(["saved", "updated", "title"]).optional(),
        tag: FIELDS.tags.element.optional(),
      }),
    )
    .output(z.object({ cursor: cursorSchema.nullable(), items: z.array(itemSummarySchema) })),

  // `from` and `count` are block positions, so a long item reads a page at a time
  read: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(
      z.strictObject({
        count: z.number().int().min(1).max(500).optional(),
        from: z.number().int().nonnegative().optional(),
        id: idSchema,
        responseFormat,
      }),
    )
    .output(itemReadSchema),

  // a note a device made, with its blocks
  create: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        blocks: z.array(placedBlockSchema).max(WRITE_OPS_MAX),
        folderId: idSchema.nullable(),
        id: newIdSchema,
        opId,
        savedAt: FIELDS.savedAt,
        tags: FIELDS.tags,
        title: FIELDS.title,
      }),
    )
    .output(landed),

  // a note from markdown, as an agent writes one
  createNote: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        folder: folderTargetSchema.optional(),
        markdown: z.string().max(MARKDOWN_MAX),
        opId,
        tags: FIELDS.tags.optional(),
        title: FIELDS.title.optional(),
      }),
    )
    .output(landed),

  // a file whose bytes are uploaded by their sha: an image, a PDF, a video, a song or any file
  createFile: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        folderId: idSchema.nullable(),
        id: newIdSchema,
        name: FIELDS.originalName.unwrap(),
        opId,
        savedAt: FIELDS.savedAt,
        sha: shaSchema,
        tags: FIELDS.tags,
        title: FIELDS.title.optional(),
      }),
    )
    .output(landed),

  // a page the device read itself (the extension, the share sheet): its facts and its article
  save: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        article: z
          .array(z.strictObject({ block: storableBlockSchema, ord: ordSchema }))
          .max(WRITE_OPS_MAX),
        copySha: shaSchema.nullable(),
        coverSha: shaSchema.nullable(),
        facts: z.strictObject({
          author: FIELDS.author,
          description: FIELDS.description,
          lang: FIELDS.lang,
          published: FIELDS.published,
          site: FIELDS.site,
        }),
        folderId: idSchema.nullable(),
        id: newIdSchema,
        opId,
        savedAt: FIELDS.savedAt,
        // the passage the person had selected, kept as a highlight
        selection: z.string().min(1).max(ANNOTATION_QUOTE_MAX).nullable(),
        tags: FIELDS.tags,
        title: FIELDS.title,
        url: FIELDS.url.unwrap(),
      }),
    )
    .output(saved),

  // a url to read later: it lands at once, unread, and the cloud reads the page; an `id` another
  // item holds is a conflict naming it
  saveLink: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        folder: folderTargetSchema.optional(),
        id: newIdSchema.optional(),
        note: z.string().max(MARKDOWN_MAX).optional(),
        opId,
        savedAt: FIELDS.savedAt.optional(),
        tags: FIELDS.tags.optional(),
        title: FIELDS.title.optional(),
        url: FIELDS.url.unwrap(),
      }),
    )
    .output(saved),

  // exact passages of the item's markdown view replaced, against the sequence it was read at
  edit: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [EditRefusedError.code]: EditRefusedError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        baseSeq: seqSchema,
        edits: z
          .array(z.strictObject({ newText: z.string(), oldText: z.string().min(1) }))
          .min(1)
          .max(50),
        id: idSchema,
        opId,
      }),
    )
    .output(
      z.object({
        // highlights the edit took a marker edge of out of the text, now unplaced
        dropped: z.array(z.string()),
        seq: seqSchema,
      }),
    ),

  // tags, folder, pin and title for many items in one change
  organize: signedBase
    .errors({
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      z
        .strictObject({
          addTags: FIELDS.tags.optional(),
          folder: folderTargetSchema.optional(),
          ids,
          opId,
          pinned: z.boolean().optional(),
          removeTags: FIELDS.tags.optional(),
          title: FIELDS.title.min(1).optional(),
        })
        .refine((input) => input.title === undefined || input.ids.length === 1, {
          error: "a title names one item",
          path: ["title"],
        }),
    )
    .output(z.object({ items: z.array(itemSummarySchema) })),

  // to Deleted, where an item can be restored
  delete: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ deleted: changedIds, missing: changedIds })),

  restore: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ missing: changedIds, restored: changedIds })),

  // emptying Deleted: an item's body and highlights go, and its id stays as a tombstone
  purge: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ missing: changedIds, purged: changedIds })),

  // the cloud reads the page again, replacing only the article
  refresh: signedBase
    .errors({ [NotFoundError.code]: NotFoundError, [QuotaError.code]: QuotaError })
    .input(z.strictObject({ id: idSchema, opId }))
    .output(landed),
};

const annotationsContract = {
  list: signedBase
    .input(
      z.strictObject({
        cursor,
        itemId: idSchema.optional(),
        limit,
        since: isoDate.optional(),
      }),
    )
    .output(z.object({ cursor: cursorSchema.nullable(), highlights: z.array(highlightSchema) })),

  // by the passage's exact text; one the item's text does not hold is kept, listed as unplaced
  add: signedBase
    .errors({
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        itemId: idSchema,
        note: z.string().max(ANNOTATION_NOTE_MAX).optional(),
        occurrence: z.number().int().positive().optional(),
        opId,
        quote: z.string().min(1).max(ANNOTATION_QUOTE_MAX),
      }),
    )
    .output(z.object({ highlight: highlightSchema })),
};

const foldersContract = {
  write: signedBase
    .errors({ [ConflictError.code]: ConflictError, [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ opId, ops: z.array(folderOpSchema).min(1).max(WRITE_OPS_MAX) }))
    .output(z.object({ seq: seqSchema })),
};

const organizeContract = {
  // the folder tree and every tag, each with how many live items it holds
  outline: signedBase.output(
    z.object({
      folders: z.array(
        z.object({
          id: idSchema,
          items: z.number().int().nonnegative(),
          name: z.string(),
          parentId: idSchema.nullable(),
        }),
      ),
      tags: z.array(z.object({ items: z.number().int().nonnegative(), tag: z.string() })),
    }),
  ),
};

const historyContract = {
  // the change sets that touched one item, or the library's newest
  list: signedBase
    .input(z.strictObject({ cursor, itemId: idSchema.optional(), limit }))
    .output(z.object({ changeSets: z.array(changeSetSchema), cursor: cursorSchema.nullable() })),

  // an item as one revision left it, for History to show and a restore to patch back
  revision: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ itemId: idSchema, rev: z.number().int().positive() }))
    .output(
      z.object({
        blocks: z.array(storedBlockSchema),
        fields: z.object(FIELDS),
        rev: z.number().int().positive(),
      }),
    ),

  // newest first, in one change set of its own; an item a later edit overlaps is kept whole
  undo: signedBase
    .errors({
      [AlreadyUndoneError.code]: AlreadyUndoneError,
      [NotFoundError.code]: NotFoundError,
    })
    .input(z.strictObject({ changeSetIds: z.array(idSchema).min(1).max(BULK_ITEMS_MAX), opId }))
    .output(
      z.object({
        changeSetId: idSchema,
        kept: z.array(idSchema),
        reverted: z.array(idSchema),
      }),
    ),
};

// an import reads a file the device uploaded to `/v1/blobs` first: a Raindrop export's CSV, or a
// zip of markdown, a vault from this app's export or Obsidian's included. The cell runs it as a
// job, a page at a time, every item it adds in one change set History shows
const importsContract = {
  start: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(z.strictObject({ opId, sha: shaSchema, source: importJobSchema.shape.source }))
    .output(z.object({ job: importJobSchema })),

  get: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(z.object({ job: importJobSchema })),

  // the newest import, null when the library never imported
  latest: signedBase.output(z.object({ job: importJobSchema.nullable() })),

  // stops after the page it is on; what it added stays, and its change set closes
  cancel: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema, opId }))
    .output(z.object({ job: importJobSchema })),
};

// the whole library as a zip in the vault's format, written by the cell and downloaded from
// `/v1/exports/<id>` until it is let go, seven days on
const exportsContract = {
  start: signedBase.input(z.strictObject({ opId })).output(z.object({ export: exportJobSchema })),

  get: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(z.object({ export: exportJobSchema })),
};

const threadAnswer = z.object({ status: z.enum(THREAD_STATUSES), threadId: idSchema });

const agentContract = {
  // a message to the built-in agent: a new thread when none is named; it waits behind the
  // account's running turn, if one is
  send: signedBase
    .errors({
      [AgentBudgetError.code]: AgentBudgetError,
      [AgentUnavailableError.code]: AgentUnavailableError,
      [NotFoundError.code]: NotFoundError,
    })
    .input(
      z.strictObject({
        opId,
        text: z.string().min(1).max(MESSAGE_MAX),
        threadId: idSchema.optional(),
        viewContext: agentViewContextSchema.optional(),
      }),
    )
    .output(threadAnswer),

  // the person's answer to a paused call, by the event that asked
  respond: signedBase
    .errors({
      [AgentUnavailableError.code]: AgentUnavailableError,
      [NotFoundError.code]: NotFoundError,
    })
    .input(
      z.strictObject({
        denyMessage: z.string().min(1).max(1000).optional(),
        eventId: eventIdSchema,
        opId,
        result: z.enum(["allow", "deny"]),
        threadId: idSchema,
      }),
    )
    .output(threadAnswer),

  // stops the turn; a paused call is denied first
  cancel: signedBase
    .errors({
      [AgentUnavailableError.code]: AgentUnavailableError,
      [NotFoundError.code]: NotFoundError,
    })
    .input(z.strictObject({ opId, threadId: idSchema }))
    .output(threadAnswer),

  list: signedBase
    .input(z.strictObject({ cursor, limit }))
    .output(z.object({ cursor: cursorSchema.nullable(), threads: z.array(threadRowSchema) })),

  // a thread's stored events after `after`, in order
  events: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(
      z.strictObject({
        after: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        threadId: idSchema,
      }),
    )
    .output(z.object({ events: z.array(threadEventRowSchema), more: z.boolean() })),

  // the thread and its conversation with Anthropic
  delete: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ opId, threadId: idSchema }))
    .output(z.object({ deleted: z.literal(true) })),

  status: signedBase.output(
    z.object({
      enabled: z.boolean(),
      // the allowance is a day's: what is left of it, and when it fills again
      turnsLeft: z.number().int().nonnegative(),
      resetsAt: z.number().int().nonnegative(),
    }),
  ),

  // off revokes the agent's access and deletes its conversations' credential at once; it stays off
  // until the person turns it on again
  setEnabled: signedBase
    .errors({ [AgentUnavailableError.code]: AgentUnavailableError })
    .input(z.strictObject({ enabled: z.boolean(), opId }))
    .output(z.object({ enabled: z.boolean() })),
};

export const libraryContract = {
  agent: agentContract,
  annotations: annotationsContract,

  exports: exportsContract,
  folders: foldersContract,
  history: historyContract,
  imports: importsContract,
  items: itemsContract,
  organize: organizeContract,

  // full-text search over titles, notes, saved articles and highlights; the app searches its own
  // replica, so this answers agents
  search: signedBase
    .input(
      z.strictObject({
        cursor,
        folderId: idSchema.optional(),
        kinds: z.array(FIELDS.kind).min(1).optional(),
        limit,
        query: z.string().trim().min(1).max(500),
        responseFormat,
        savedAfter: isoDate.optional(),
        savedBefore: isoDate.optional(),
        tag: FIELDS.tags.element.optional(),
      }),
    )
    .output(z.object({ cursor: cursorSchema.nullable(), hits: z.array(searchHitSchema) })),

  sync: syncContract,

  // one item's ops and highlight writes, guarded block by block and field by field: it lands
  // whole or answers every conflict. `write`, not `apply`: a client's path is a function's
  // property, and `apply` would be Function.prototype's
  write: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z
        .strictObject({
          annotations: z.array(annotationOpSchema).max(WRITE_OPS_MAX).optional(),
          itemId: idSchema,
          opId,
          ops: z.array(libraryOpSchema).max(WRITE_OPS_MAX),
        })
        .refine((input) => input.ops.length > 0 || (input.annotations ?? []).length > 0, {
          error: "a write changes something",
        }),
    )
    .output(landed),
};
