// The library's procedures, @repo/service their one implementation and `/v1/rpc/library` serving
// every one. The apps call the rows their screens need; an agent calls the rows tagged as tools, a
// connected assistant through the connector and the built-in agent as the person, and the apps
// call only a few of those. A write takes an optional `opId`, which the service keeps, so a save
// queue resending after a lost answer lands once. Which of these an agent sees as a tool, and how
// it is titled, is the service's to tag (packages/service/src/library/library-tools.ts); nothing
// here names MCP or OpenAPI.

import { eventIterator } from "@orpc/contract";
import { z } from "zod";

import { propertyOpSchema } from "../library/field-ops";
import { importedFieldsSchema, libraryItemFieldsSchema } from "../library/library-item";
import { storableBlockSchema } from "../library/library-nodes";
import { listingSortSchema } from "../library/listing-sort";

import {
  AgentBudgetError,
  AgentUnavailableError,
  BlobMismatchError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
  signedBase,
} from "./v1-errors";
import {
  agentViewContextSchema,
  bodyVersionSchema,
  bodyWriteSchema,
  BULK_ITEMS_MAX,
  cursorSchema,
  folderCountSchema,
  folderNameSchema,
  folderOpSchema,
  FOLDER_NAME_MAX,
  folderPathNames,
  isoDate,
  idSchema,
  IMPORT_STANDINGS,
  itemReadSchema,
  itemSummarySchema,
  kindsSchema,
  libraryMovedSchema,
  liveItemRowSchema,
  FILING_RULES_MAX,
  folderRowSchema,
  listedItemSchema,
  listingPageInputSchema,
  MARKDOWN_MAX,
  MESSAGE_MAX,
  newIdSchema,
  opIdSchema,
  PAGE_MAX,
  newBodyBlockSchema,
  responseFormatSchema,
  searchHitSchema,
  seqSchema,
  shaSchema,
  sweptSchema,
  bodyBlockSchema,
  tagCountSchema,
  THREAD_STATUSES,
  threadRowSchema,
  threadStreamEventSchema,
  WRITE_OPS_MAX,
} from "../library/library-wire";

const FIELDS = libraryItemFieldsSchema.shape;
const opId = opIdSchema.optional();
// a list's page: at most `limit` rows from `cursor`, its answer's `cursor` the next page's
const limit = z.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX);
const cursor = cursorSchema.default(0);
const nextCursor = cursorSchema.nullable();
const responseFormat = responseFormatSchema.default("concise");
const ids = z.array(idSchema).min(1).max(BULK_ITEMS_MAX);
const count = z.number().int().nonnegative();

// a write that makes an item answers with its row as it landed
const landed = z.object({ item: liveItemRowSchema });
// an item's row as a screen showing its body reads it, with the version its body stands at
const openItemRow = liveItemRowSchema.extend({ bodyVersion: bodyVersionSchema });
// a save of a url the library holds answers that item as it stands, `created` false
const saved = z.object({ created: z.boolean(), item: liveItemRowSchema });

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
    { error: `names each folder in 1 to ${String(FOLDER_NAME_MAX)} characters` },
  );
const folderTargetSchema = z
  .union([z.strictObject({ id: idSchema }), z.strictObject({ path: folderPathSchema })])
  .nullable();

const saveLinkInputSchema = z.strictObject({
  folder: folderTargetSchema.optional(),
  id: newIdSchema.optional(),
  note: z.string().max(MARKDOWN_MAX).optional(),
  opId,
  savedAt: FIELDS.savedAt.optional(),
  tags: FIELDS.tags.optional(),
  title: FIELDS.title.optional(),
  url: FIELDS.url.unwrap(),
});
const deleteInputSchema = z.strictObject({ ids, opId });

// what an organize answers, and what the cell keeps under its op id to answer a resend
export const organizedSchema = z.object({ items: z.array(itemSummarySchema) });

// tags, folder, pin and title for the items a call names by id
const organizeInputSchema = z.strictObject({
  addTags: FIELDS.tags.optional(),
  folder: folderTargetSchema.optional(),
  ids,
  opId,
  pinned: z.boolean().optional(),
  removeTags: FIELDS.tags.optional(),
  title: FIELDS.title.min(1).optional(),
});

// what a sweep does to each item it takes: an organize's change but a title, or to Deleted, back
// from it, or out of it for good
export const sweepVerbSchema = z.discriminatedUnion("kind", [
  organizeInputSchema
    .omit({ ids: true, opId: true, title: true })
    .extend({ kind: z.literal("organize") }),
  z.strictObject({ kind: z.enum(["delete", "restore", "purge"]) }),
]);

// the inputs of the rows that read for an agent, by name: the cell's reads take each as its
// schema parsed it, every default in place (packages/service/src/library/cell-reads.ts)
export const listInputSchema = z.strictObject({
  cursor,
  // a folder and every folder under it
  folderId: idSchema.optional(),
  kinds: kindsSchema.optional(),
  limit,
  pinned: z.boolean().optional(),
  responseFormat,
  sort: listingSortSchema.default("saved"),
  // a tag and every tag under it
  tag: FIELDS.tags.element.optional(),
});
// `from` and `count` are block positions, so a long item reads a page at a time
export const readInputSchema = z.strictObject({
  count: z.number().int().min(1).max(500).default(200),
  from: z.number().int().nonnegative().default(0),
  id: idSchema,
  responseFormat,
});
export const searchInputSchema = z.strictObject({
  cursor,
  folderId: idSchema.optional(),
  kinds: kindsSchema.optional(),
  limit,
  query: z.string().trim().min(1).max(500),
  responseFormat,
  savedAfter: isoDate.optional(),
  savedBefore: isoDate.optional(),
  tag: FIELDS.tags.element.optional(),
});

const itemsContract = {
  list: signedBase
    .input(listInputSchema)
    .output(z.object({ cursor: nextCursor, items: z.array(itemSummarySchema) })),

  read: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(readInputSchema)
    .output(itemReadSchema),

  // an item whole, its row and every block in reading order, for the apps; Deleted's items too
  get: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(openItemRow.extend({ blocks: z.array(bodyBlockSchema) })),

  // an item's row without its body's blocks: what a screen draws beside an open note, read again
  // to learn whether someone saved the body since, at no cost of its blocks
  row: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(openItemRow),

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
        blocks: z.array(newBodyBlockSchema).max(WRITE_OPS_MAX),
        folderId: idSchema.nullable(),
        id: newIdSchema,
        opId,
        savedAt: FIELDS.savedAt,
        tags: FIELDS.tags,
        title: FIELDS.title,
      }),
    )
    .output(landed),

  // a note from markdown, as an agent writes one: an item link `[Title](mention:<id>)`, or
  // `[[Title]]` for the one item so titled; its title and tags are the request's alone, so a `---`
  // block opening the markdown is a code block
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

  // a page the device read itself (the extension): its facts and its article; an item already at
  // the url takes them only while it has no article, its reading waiting or failed
  save: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        article: z.array(storableBlockSchema).max(WRITE_OPS_MAX),
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
        // the person's words saved with the page, as markdown, kept in the item's note
        note: z.string().max(MARKDOWN_MAX).optional(),
        opId,
        savedAt: FIELDS.savedAt,
        tags: FIELDS.tags,
        title: FIELDS.title,
        url: FIELDS.url.unwrap(),
      }),
    )
    .output(saved),

  // a url to read later: it lands at once, unread, and the cloud reads the page; an item already
  // at the url is answered as it stands, nothing of this landing on it; an `id` another item holds
  // is a conflict naming it
  saveLink: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(saveLinkInputSchema)
    .output(saved),

  // exact passages of the note in the item's markdown view replaced in its body as it stands,
  // typing around them kept, and an empty `oldText`'s new text added after the note; the new text
  // names items as `createNote`'s does
  edit: signedBase
    .errors({
      [EditRefusedError.code]: EditRefusedError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      z.strictObject({
        edits: z
          .array(z.strictObject({ newText: z.string(), oldText: z.string() }))
          .min(1)
          .max(50),
        id: idSchema,
        opId,
      }),
    )
    .output(z.object({ seq: seqSchema })),

  // a note's body as a person's device holds it, whole, over the version it was opened at; a save
  // made over an older one answers `stale`, and the device merges by block and saves again. One
  // naming a file the library doesn't hold is refused BLOB_MISSING, which the device stops on until
  // its blocks change. An agent writes by passage through `edit` instead, which lands on the body
  // as it stands
  saveBody: signedBase
    .errors({ [BlobMissingError.code]: BlobMissingError, [NotFoundError.code]: NotFoundError })
    .input(
      z.strictObject({
        baseVersion: bodyVersionSchema,
        blocks: z.array(newBodyBlockSchema),
        id: idSchema,
      }),
    )
    .output(bodyWriteSchema),

  // tags, folder, pin and title for many items in one change
  organize: signedBase
    .errors({
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      organizeInputSchema.refine((input) => input.title === undefined || input.ids.length === 1, {
        error: "a title names one item",
        path: ["title"],
      }),
    )
    .output(organizedSchema),

  // to Deleted, where an item can be restored
  delete: signedBase
    .input(deleteInputSchema)
    .output(z.object({ deleted: changedIds, missing: changedIds })),

  // `addressHeld`: left in Deleted, each address another live item's now
  restore: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ addressHeld: changedIds, missing: changedIds, restored: changedIds })),

  // emptying Deleted: an item's body goes, and its id stays as a tombstone
  purge: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ missing: changedIds, purged: changedIds })),

  // A verb over every item a scope lists, for the apps, whose grid selects a scope it read only
  // some pages of; an agent names its items by id, so no tool carries this. It takes the items the
  // scope lists as it is asked and lands them in the call, each by its verb's own rule: `items`
  // counts what it took, and `refused` names those a rule left as they were, a link whose address
  // another live item holds or an item past its tags' cap. A change of tags over more than 5,000
  // items lands a lot at a time after the answer, which then names none
  sweep: signedBase
    .input(sweptSchema.extend({ opId, verb: sweepVerbSchema }))
    .output(z.object({ items: count, refused: changedIds })),

  // the cloud reads the page again, replacing only the article
  refresh: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema, opId }))
    .output(landed),
};

const foldersContract = {
  write: signedBase
    .errors({ [ConflictError.code]: ConflictError, [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ opId, ops: z.array(folderOpSchema).min(1).max(WRITE_OPS_MAX) }))
    // every folder the write left changed, those a deleted one took with it included
    .output(z.object({ folders: z.array(folderRowSchema), seq: seqSchema })),
};

// what the apps' screens list, each answered from the cell's rows as they stand
const listingContract = {
  // a page of a scope's items, each a search found with the passage that matched. `kindCounts`
  // counts the scope's items by kind, the page's own kinds aside
  page: signedBase.input(listingPageInputSchema).output(
    z.object({
      cursor: nextCursor,
      items: z.array(listedItemSchema),
      kindCounts: z.record(FIELDS.kind, count),
      total: count,
    }),
  ),

  // what the rail counts: the library, Unsorted, untagged and Deleted; every live folder in rail
  // order (a parent before its children, siblings by their order key); every tag under its first
  // spelling, the most held first
  scopes: signedBase.output(
    z.object({
      deleted: count,
      folders: z.array(folderCountSchema),
      tags: z.array(tagCountSchema),
      total: count,
      unsorted: count,
      untagged: count,
    }),
  ),

  // every item in the library by title, which a note's links and the openers resolve against
  titles: signedBase.output(
    z.object({ targets: z.array(z.object({ id: idSchema, title: z.string() })) }),
  ),
};

const organizeContract = {
  // the folder tree and every tag as the rail counts them, for an agent
  outline: signedBase.output(
    z.object({
      folders: z.array(folderCountSchema.omit({ sort: true })),
      tags: z.array(tagCountSchema),
    }),
  ),
};

// an item an import lands: one the device read (`new`), filed under the folder path it stood in,
// with the picture its source named for the cloud's reading to try after the page's; or one in
// Deleted it brings back (`restore`). A device parses each through this before it sends a batch,
// since one the row refuses refuses the batch
export const importedItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    blocks: z.array(newBodyBlockSchema).max(WRITE_OPS_MAX),
    cover: FIELDS.url,
    fields: importedFieldsSchema,
    folder: folderPathSchema.nullable(),
    id: idSchema,
    kind: z.literal("new"),
  }),
  z.strictObject({ id: idSchema, kind: z.literal("restore") }),
]);

// an import the device reads itself, a Raindrop export or a zip of notes, Obsidian's included:
// it asks how the notes it planned stand, lands its items a batch at a time and asks what the
// landed items name of its files. An item's id is the device's, made from where it stood in the
// file, so a batch sent again, or the same file picked again, lands nothing twice
const importsContract = {
  // each note in the order asked: `held` by an item the library holds by its id or its address,
  // whose id it answers; `deleted`, its item in Deleted; `new`, to land, under a fresh id when a
  // purged item kept the one planned
  settle: signedBase
    .input(
      z.strictObject({
        notes: z
          .array(z.strictObject({ id: idSchema, url: FIELDS.url }))
          .min(1)
          .max(BULK_ITEMS_MAX),
      }),
    )
    .output(
      z.object({
        notes: z.array(z.object({ id: idSchema, standing: z.enum(IMPORT_STANDINGS) })),
      }),
    ),

  // which of these files a live item names, and which of them an item holds as its own original
  named: signedBase
    .input(z.strictObject({ shas: z.array(shaSchema).min(1).max(BULK_ITEMS_MAX) }))
    .output(z.object({ named: z.array(shaSchema), originals: z.array(shaSchema) })),

  // a batch: an item the library holds already is counted, one a rule refuses is counted
  // unreadable while the rest land, and a library too full for the batch takes none of it
  land: signedBase
    .errors({ [QuotaError.code]: QuotaError })
    .input(z.strictObject({ items: z.array(importedItemSchema).min(1).max(BULK_ITEMS_MAX), opId }))
    .output(z.object({ added: count, alreadySaved: count, unreadable: count })),
};

// what `reserve` hands a device for the bytes it then sends to the store and names to `settle`
const uploadIdSchema = z.string().min(1).max(1000);

// A file's bytes go to the store outside `/v1`, between two calls: `reserve` asks where, and
// `settle` keeps what arrived once its bytes hash to its sha. A file the library holds already is
// `held`, and nothing is sent
const filesContract = {
  // where to send a file of `bytes` as `mime`: a PUT to `url`, which names the store and may be a
  // path on the cloud's own origin, with `headers`; past BLOB_MAX_BYTES or the library's room it is
  // refused before anything is sent
  reserve: signedBase
    .errors({
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        bytes: z.number().int().nonnegative(),
        mime: z.string().max(255),
        sha: shaSchema,
      }),
    )
    .output(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("held") }),
        z.object({
          headers: z.record(z.string(), z.string()),
          kind: z.literal("upload"),
          uploadId: uploadIdSchema,
          url: z.string().min(1),
        }),
      ]),
    ),

  // the upload `reserve` named, kept once its bytes are the size it named and hash to `sha`; one
  // that does not is refused and let go, and a sha the library came to hold meanwhile is `held`.
  // Sent again it finds the file kept, so it takes no opId
  settle: signedBase
    .errors({
      [BlobMismatchError.code]: BlobMismatchError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(z.strictObject({ sha: shaSchema, uploadId: uploadIdSchema }))
    .output(z.object({ kind: z.enum(["held", "kept"]) })),
};

const threadAnswer = z.object({ status: z.enum(THREAD_STATUSES), threadId: idSchema });
// a turn by its number in its thread, as its `turn.ended` event names it
const turnNumber = z.number().int().positive();

const agentContract = {
  // a message to the built-in agent: a new thread when none is named; sent while the thread's turn
  // runs, it joins that turn, which reads it at its next step
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

  // stops the thread's running turn where it is: what it already wrote stays, Undo's to take back
  cancel: signedBase
    .errors({
      [AgentUnavailableError.code]: AgentUnavailableError,
      [NotFoundError.code]: NotFoundError,
    })
    .input(z.strictObject({ opId, threadId: idSchema }))
    .output(threadAnswer),

  list: signedBase
    .input(z.strictObject({ cursor, limit }))
    .output(z.object({ cursor: nextCursor, threads: z.array(threadRowSchema) })),

  // Follows a thread: its events, then what happens as it happens, until the thread is gone or the
  // stream is cut, as it is minutes on (apps/web/src/app/v1/rpc/library/agent/events/route.ts). A
  // reconnect sends the last id it read as its `lastEventId` and resumes after it
  events: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ threadId: idSchema }))
    .output(eventIterator(threadStreamEventSchema)),

  // the thread read by nothing from now on; its agent session is ended, keeping a record that its
  // runs happened but not what was said, then its row, events and turns go. What its turns spent
  // stays in the day's ledger, and what Undo keeps of them until its seven days lapse
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

  // off stops every open turn and refuses sends until the person turns it on again; threads stay
  // readable
  setEnabled: signedBase
    .errors({ [AgentUnavailableError.code]: AgentUnavailableError })
    .input(z.strictObject({ enabled: z.boolean(), opId }))
    .output(z.object({ enabled: z.boolean() })),

  // the person's filing rules, which the agent follows over its own taste in every conversation;
  // null while the library keeps none
  rules: signedBase.output(z.object({ rules: z.string().nullable() })),

  // the filing rules as the person wrote them, from the next turn on; an import never replaces them
  setRules: signedBase
    .input(z.strictObject({ opId, rules: z.string().max(FILING_RULES_MAX) }))
    .output(z.object({ rules: z.string() })),

  // the thread's ended turns that still hold something Undo takes back, oldest first; a turn goes
  // seven days after it ended
  undoable: signedBase
    .input(z.strictObject({ threadId: idSchema }))
    .output(z.object({ turns: z.array(turnNumber) })),

  // What the thread's turns changed, taken back in one write: one turn, or the conversation's,
  // newest first, so many a call, those before `before`. `next` is where the turns this call left
  // start, null once none wait. An item someone changed since, in a field the turn wrote or in its
  // body at all, is named under `kept` and left whole, and one a rule refuses under `refused`,
  // each left to undo again; when a rule held back all that could land, its own error is the
  // answer. A turn with nothing left to take back, already undone or still open, changes nothing,
  // so the call takes no opId: sent again, it finds nothing left
  undo: signedBase
    .errors({
      [BlobMissingError.code]: BlobMissingError,
      [ConflictError.code]: ConflictError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      z.union([
        z.strictObject({ threadId: idSchema, turn: turnNumber }),
        z.strictObject({ before: turnNumber.optional(), threadId: idSchema }),
      ]),
    )
    .output(
      z.object({
        kept: z.array(idSchema),
        next: turnNumber.nullable(),
        refused: z.array(idSchema),
        reverted: z.array(idSchema),
      }),
    ),
};

export const libraryContract = {
  agent: agentContract,

  // the library's head and what moved after `after`, the head this device last read, for a device
  // to read again only what it shows of that. With no `after` it learns the head alone, and where
  // nothing moved it names nothing
  changes: signedBase
    .input(z.strictObject({ after: seqSchema.optional() }))
    .output(z.object({ head: seqSchema, moved: libraryMovedSchema.nullable() })),

  files: filesContract,

  folders: foldersContract,

  // how an item's text is written, as markdown, for an assistant that writes one: the library's
  // own blocks beyond stock markdown and how items are saved, filed and tagged; no app calls it
  guide: signedBase.output(z.object({ markdown: z.string() })),

  imports: importsContract,
  items: itemsContract,
  listing: listingContract,
  organize: organizeContract,

  // full-text search over titles, notes and saved articles, for agents; the apps search through
  // `listing.page`'s words
  search: signedBase
    .input(searchInputSchema)
    .output(z.object({ cursor: nextCursor, hits: z.array(searchHitSchema) })),

  // one item's property ops, each guarded by its base, landing whole or not at all. Every other
  // field moves by a verb of `items`, which asks the reading or tells the note with it, and a body
  // is saved by `items.saveBody`. `write`, not `apply`: a client's path is a function's property,
  // and `apply` would be Function.prototype's
  write: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      z.strictObject({
        itemId: idSchema,
        opId,
        ops: z.array(propertyOpSchema).min(1).max(WRITE_OPS_MAX),
      }),
    )
    .output(landed),
};
