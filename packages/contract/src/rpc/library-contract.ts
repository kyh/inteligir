import { eventIterator } from "@orpc/contract";
import { z } from "zod";

import { propertyOpSchema } from "../library/field-ops";
import { importedFieldsSchema, libraryItemFieldsSchema, shaSchema } from "../library/library-item";
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
  count,
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
const limit = z.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX);
const cursor = cursorSchema.default(0);
const nextCursor = cursorSchema.nullable();
const responseFormat = responseFormatSchema.default("concise");
const ids = z.array(idSchema).min(1).max(BULK_ITEMS_MAX);

const landed = z.object({ item: liveItemRowSchema });
const openItemRow = liveItemRowSchema.extend({ bodyVersion: bodyVersionSchema });
const saved = z.object({ created: z.boolean(), item: liveItemRowSchema });

const changedIds = z.array(idSchema);

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

export const organizedSchema = z.object({ items: z.array(itemSummarySchema) });

const organizeInputSchema = z.strictObject({
  addTags: FIELDS.tags.optional(),
  folder: folderTargetSchema.optional(),
  ids,
  opId,
  pinned: z.boolean().optional(),
  removeTags: FIELDS.tags.optional(),
  title: FIELDS.title.min(1).optional(),
});

export const sweepVerbSchema = z.discriminatedUnion("kind", [
  organizeInputSchema
    .omit({ ids: true, opId: true, title: true })
    .extend({ kind: z.literal("organize") }),
  z.strictObject({ kind: z.enum(["delete", "restore", "purge"]) }),
]);

export const listInputSchema = z.strictObject({
  cursor,
  folderId: idSchema.optional(),
  kinds: kindsSchema.optional(),
  limit,
  pinned: z.boolean().optional(),
  responseFormat,
  sort: listingSortSchema.default("saved"),
  tag: FIELDS.tags.element.optional(),
});

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

  get: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(openItemRow.extend({ blocks: z.array(bodyBlockSchema) })),

  row: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema }))
    .output(openItemRow),

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
        note: z.string().max(MARKDOWN_MAX).optional(),
        opId,
        savedAt: FIELDS.savedAt,
        tags: FIELDS.tags,
        title: FIELDS.title,
        url: FIELDS.url.unwrap(),
      }),
    )
    .output(saved),

  saveLink: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(saveLinkInputSchema)
    .output(saved),

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

  delete: signedBase
    .input(deleteInputSchema)
    .output(z.object({ deleted: changedIds, missing: changedIds })),

  restore: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ addressHeld: changedIds, missing: changedIds, restored: changedIds })),

  purge: signedBase
    .input(z.strictObject({ ids, opId }))
    .output(z.object({ missing: changedIds, purged: changedIds })),

  sweep: signedBase
    .input(sweptSchema.extend({ opId, verb: sweepVerbSchema }))
    .output(z.object({ items: count, refused: changedIds })),

  refresh: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ id: idSchema, opId }))
    .output(landed),
};

const foldersContract = {
  write: signedBase
    .errors({ [ConflictError.code]: ConflictError, [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ opId, ops: z.array(folderOpSchema).min(1).max(WRITE_OPS_MAX) }))
    .output(z.object({ folders: z.array(folderRowSchema), seq: seqSchema })),
};

const listingContract = {
  page: signedBase.input(listingPageInputSchema).output(
    z.object({
      cursor: nextCursor,
      items: z.array(listedItemSchema),
      kindCounts: z.record(FIELDS.kind, count),
      total: count,
    }),
  ),

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

  titles: signedBase.output(
    z.object({ targets: z.array(z.object({ id: idSchema, title: z.string() })) }),
  ),
};

const organizeContract = {
  outline: signedBase.output(
    z.object({
      folders: z.array(folderCountSchema.omit({ sort: true })),
      tags: z.array(tagCountSchema),
    }),
  ),
};

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

const importsContract = {
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

  named: signedBase
    .input(z.strictObject({ shas: z.array(shaSchema).min(1).max(BULK_ITEMS_MAX) }))
    .output(z.object({ named: z.array(shaSchema), originals: z.array(shaSchema) })),

  land: signedBase
    .errors({ [QuotaError.code]: QuotaError })
    .input(z.strictObject({ items: z.array(importedItemSchema).min(1).max(BULK_ITEMS_MAX), opId }))
    .output(z.object({ added: count, alreadySaved: count, unreadable: count })),
};

const uploadIdSchema = z.string().min(1).max(1000);

const filesContract = {
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
const turnNumber = z.number().int().positive();

const agentContract = {
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

  events: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ threadId: idSchema }))
    .output(eventIterator(threadStreamEventSchema)),

  delete: signedBase
    .errors({ [NotFoundError.code]: NotFoundError })
    .input(z.strictObject({ opId, threadId: idSchema }))
    .output(z.object({ deleted: z.literal(true) })),

  status: signedBase.output(
    z.object({
      enabled: z.boolean(),
      turnsLeft: z.number().int().nonnegative(),
      resetsAt: z.number().int().nonnegative(),
    }),
  ),

  setEnabled: signedBase
    .errors({ [AgentUnavailableError.code]: AgentUnavailableError })
    .input(z.strictObject({ enabled: z.boolean(), opId }))
    .output(z.object({ enabled: z.boolean() })),

  rules: signedBase.output(z.object({ rules: z.string().nullable() })),

  setRules: signedBase
    .input(z.strictObject({ opId, rules: z.string().max(FILING_RULES_MAX) }))
    .output(z.object({ rules: z.string() })),

  undoable: signedBase
    .input(z.strictObject({ threadId: idSchema }))
    .output(z.object({ turns: z.array(turnNumber) })),

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

  changes: signedBase
    .input(z.strictObject({ after: seqSchema.optional() }))
    .output(z.object({ head: seqSchema, moved: libraryMovedSchema.nullable() })),

  files: filesContract,

  folders: foldersContract,

  guide: signedBase.output(z.object({ markdown: z.string() })),

  imports: importsContract,
  items: itemsContract,
  listing: listingContract,
  organize: organizeContract,

  search: signedBase
    .input(searchInputSchema)
    .output(z.object({ cursor: nextCursor, hits: z.array(searchHitSchema) })),

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
