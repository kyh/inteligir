import { eventIterator } from "@orpc/contract";
import { z } from "zod";

import { isContainerKind, ITEM_KINDS } from "../items/item-kind";
import { propertyOpSchema } from "../library/field-ops";
import {
  importedFieldsSchema,
  libraryItemFieldsSchema,
  LIST_PROPERTIES_MAX,
  listSettingsSchema,
  propertyKeySchema,
  shaSchema,
} from "../library/library-item";
import { ITEM_FIELD_CAPS } from "../items/item-field-caps";
import { storableBlockSchema } from "../library/library-nodes";
import { listingSortSchema } from "../library/listing-sort";
import { savedViewSchema, savedViewsSchema } from "../library/saved-views";

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
  containerCountSchema,
  folderNameSchema,
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
  treeChildrenSchema,
  WRITE_OPS_MAX,
} from "../library/library-wire";

const CREATED_KINDS = ["note", "folder", "list"] as const;

const FIELDS = libraryItemFieldsSchema.shape;

const opId = opIdSchema
  .optional()
  .describe(
    "Optional idempotency key: a fresh UUID you mint for this one write. A retry with the same opId within 30 days answers the first write's result instead of writing again, so reuse one only to resend the same call; omit it for no replay protection.",
  );

const limit = z
  .number()
  .int()
  .min(1)
  .max(PAGE_MAX)
  .default(PAGE_MAX)
  .describe(
    `Most results on this page, 1 to ${String(PAGE_MAX)}; defaults to ${String(PAGE_MAX)}.`,
  );

const cursor = cursorSchema
  .default(0)
  .describe(
    "Where the page starts: 0 (the default) for the first page, then the cursor the previous answer gave. An answer whose cursor is null was the last page.",
  );

const nextCursor = cursorSchema.nullable();
const responseFormat = responseFormatSchema.default("concise");
const ids = z.array(idSchema).min(1).max(BULK_ITEMS_MAX);

const landed = z.object({ item: liveItemRowSchema });
const openItemRow = liveItemRowSchema.extend({ bodyVersion: bodyVersionSchema });
const saved = z.object({ created: z.boolean(), item: liveItemRowSchema });

const ITEM_ID = "an item's id (a UUID), as list_items, search_library or a write's answer gave it";

const TAG_NAMES = `Tag names without the #, e.g. ["reading", "work/clients"]: each starts with a letter and holds letters, digits, _ or -, with / before a nested tag; matched ignoring case.`;

const TAG_FILTER =
  'Keeps items with this tag, or one nested under it ("work" also matches "work/clients"), ignoring case; written without the #. It includes #tags written in an item\'s text.';

const PARENT_FILTER =
  "Keeps items inside this folder, list or note, at any depth: its id (a UUID), as list_tags_and_folders, list_items or search_library gave it. Omit it for the whole library.";

const KINDS_FILTER = `Item kinds to keep, one or more of ${ITEM_KINDS.filter((kind) => !isContainerKind(kind)).join(", ")}; omit for every kind. Folders and lists never appear here: list_tags_and_folders lists them.`;

const NEW_TITLE = (what: string) =>
  `Title for the new ${what}, up to ${String(ITEM_FIELD_CAPS.line)} characters.`;

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

const parentTargetSchema = z
  .union([
    z.strictObject({
      id: idSchema.describe(
        "The id (a UUID) of a folder, list or note to file under, as list_tags_and_folders, list_items or search_library gave it. A folder or list goes only in a folder.",
      ),
    }),
    z.strictObject({
      path: folderPathSchema.describe(
        `A folder path from the top of the library, folder names joined by /, e.g. "Reading/2026": each name 1 to ${String(FOLDER_NAME_MAX)} characters, matched to an existing folder ignoring case, and made when missing.`,
      ),
    }),
  ])
  .nullable();

const PARENT_TARGET =
  'Where to file it: {"id": ...} for a folder, list or note by its id, {"path": ...} for a folder path made when new, or null for the top of the library.';

const saveLinkInputSchema = z.strictObject({
  parent: parentTargetSchema
    .optional()
    .describe(`${PARENT_TARGET} Omit it to save at the top of the library.`),
  id: newIdSchema
    .optional()
    .describe(
      "Id for the new item, a UUIDv7 you mint; omit it to have one minted. Ignored when the address is already saved.",
    ),
  note: z
    .string()
    .max(MARKDOWN_MAX)
    .optional()
    .describe(
      `A note to keep with the link, as markdown up to ${String(MARKDOWN_MAX)} characters, spelled as read_guide says; omitted or blank, the link has no note.`,
    ),
  opId,
  savedAt: FIELDS.savedAt
    .optional()
    .describe(
      "When the link was saved, as whole milliseconds since the Unix epoch (e.g. 1767225600000 for 2026-01-01); defaults to now.",
    ),
  tags: FIELDS.tags
    .optional()
    .describe(`${TAG_NAMES} Up to ${String(ITEM_FIELD_CAPS.listEntries)}; omit for none.`),
  title: FIELDS.title
    .optional()
    .describe(
      `${NEW_TITLE("item")} Omit it to take the page's own title once it is read, and the address's name until then.`,
    ),
  url: FIELDS.url
    .unwrap()
    .describe(
      `The web address to save, starting http:// or https://, up to ${String(ITEM_FIELD_CAPS.url)} characters. An address the library already holds answers that item unchanged.`,
    ),
});

const deleteInputSchema = z.strictObject({
  ids: ids.describe(
    `Ids of the items to move to Deleted, 1 to ${String(BULK_ITEMS_MAX)}, each ${ITEM_ID}. Ids that match no item are answered under missing.`,
  ),
  opId,
});

export const organizedSchema = z.object({ items: z.array(itemSummarySchema) });

const organizeInputSchema = z.strictObject({
  addTags: FIELDS.tags
    .optional()
    .describe(`Tags to add. ${TAG_NAMES} A tag the item already has is not added twice.`),
  parent: parentTargetSchema
    .optional()
    .describe(`${PARENT_TARGET} Omit it to leave the items where they are.`),
  ids: ids.describe(
    `Ids of the items to change, 1 to ${String(BULK_ITEMS_MAX)}, each ${ITEM_ID}. If any matches no item, nothing is changed.`,
  ),
  opId,
  pinned: z
    .boolean()
    .optional()
    .describe("true pins the items and false unpins them; omit it to leave them as they are."),
  removeTags: FIELDS.tags
    .optional()
    .describe(
      `Tags to remove. ${TAG_NAMES} A #tag written in an item's text stays: only edit_item takes it out.`,
    ),
  title: FIELDS.title
    .min(1)
    .optional()
    .describe(
      `New title, 1 to ${String(ITEM_FIELD_CAPS.line)} characters, only when ids names exactly one item; omit it to keep the title.`,
    ),
});

export const sweepVerbSchema = z.discriminatedUnion("kind", [
  organizeInputSchema
    .omit({ ids: true, opId: true, title: true })
    .extend({ kind: z.literal("organize") }),
  z.strictObject({ kind: z.enum(["delete", "restore", "purge"]) }),
]);

export const listInputSchema = z.strictObject({
  cursor,
  parentId: idSchema.optional().describe(PARENT_FILTER),
  kinds: kindsSchema.optional().describe(KINDS_FILTER),
  limit,
  pinned: z
    .boolean()
    .optional()
    .describe("true lists only pinned items and false only unpinned ones; omit it for both."),
  responseFormat: responseFormat.describe(
    "concise (the default) answers each item's id, title, kind, tags, parent, pin, address and saved time; detailed adds a preview of its text and its site.",
  ),
  sort: listingSortSchema
    .default("saved")
    .describe(
      "saved (the default) lists newest saved first, modified most recently changed first, title A to Z; pinned items come first in every order.",
    ),
  tag: FIELDS.tags.element.optional().describe(TAG_FILTER),
});

export const readInputSchema = z.strictObject({
  count: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200)
    .describe(
      "Most blocks of text to answer, 1 to 500; defaults to 200. A page also stops at about 16,000 characters, so read on from the answer's view.to.",
    ),
  from: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      "Position of the first block to answer, counted from 0 (the default, the start). To read on, pass the view.to of the previous answer; view.total is the item's count of blocks.",
    ),
  id: idSchema.describe(`The item to read: ${ITEM_ID}.`),
  responseFormat: responseFormat.describe(
    "concise (the default) or detailed, which adds the item's aliases and properties to its fields.",
  ),
});

export const searchInputSchema = z.strictObject({
  cursor,
  parentId: idSchema.optional().describe(PARENT_FILTER),
  kinds: kindsSchema.optional().describe(KINDS_FILTER),
  limit,
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'Plain words to find in titles, notes and saved articles, 1 to 500 characters, e.g. "sourdough starter": matched by word stem, the last word also as a prefix, with no operators or quotes.',
    ),
  responseFormat: responseFormat.describe(
    "concise (the default) cuts each hit's snippet to 160 characters; detailed answers the whole matching passage.",
  ),
  savedAfter: isoDate
    .optional()
    .describe(
      "Keeps items saved on or after this day, as an ISO date (YYYY-MM-DD, read in UTC), e.g. 2026-01-31; omit it for no lower bound.",
    ),
  savedBefore: isoDate
    .optional()
    .describe(
      "Keeps items saved on or before this day, as an ISO date (YYYY-MM-DD, read in UTC), the whole day included; omit it for no upper bound.",
    ),
  tag: FIELDS.tags.element.optional().describe(TAG_FILTER),
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
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
      [QuotaError.code]: QuotaError,
    })
    .input(
      z.strictObject({
        blocks: z.array(newBodyBlockSchema).max(WRITE_OPS_MAX),
        id: newIdSchema,
        kind: z.enum(CREATED_KINDS).default("note"),
        opId,
        parentId: idSchema.nullable(),
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
        parent: parentTargetSchema
          .optional()
          .describe(`${PARENT_TARGET} Omit it to make the note at the top of the library.`),
        markdown: z
          .string()
          .max(MARKDOWN_MAX)
          .describe(
            `The note's text as markdown, up to ${String(MARKDOWN_MAX)} characters, with the library's own blocks spelled as read_guide says; link another item as [Title](mention:id).`,
          ),
        opId,
        tags: FIELDS.tags
          .optional()
          .describe(`${TAG_NAMES} Up to ${String(ITEM_FIELD_CAPS.listEntries)}; omit for none.`),
        title: FIELDS.title
          .optional()
          .describe(`${NEW_TITLE("note")} Omit it and the note shows by its first line.`),
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
        parentId: idSchema.nullable(),
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
        parentId: idSchema.nullable(),
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
          .array(
            z.strictObject({
              newText: z
                .string()
                .describe(
                  "Markdown to put in place of oldText; empty deletes the passage. Link another item as [Title](mention:id).",
                ),
              oldText: z
                .string()
                .describe(
                  "An exact passage of the note's markdown, as read_item answered it, that stands exactly once in the note as it is now; empty adds newText after the note.",
                ),
            }),
          )
          .min(1)
          .max(50)
          .describe(
            "The passages to replace, 1 to 50, applied in order, each to the note as the edits before it left it. If any is refused, none is applied.",
          ),
        id: idSchema.describe(`The item whose note to change: ${ITEM_ID}.`),
        opId,
      }),
    )
    .output(z.object({ seq: seqSchema })),

  setList: signedBase
    .errors({
      [ConflictError.code]: ConflictError,
      [NotFoundError.code]: NotFoundError,
      [PayloadTooLargeError.code]: PayloadTooLargeError,
    })
    .input(
      z.strictObject({
        id: idSchema,
        list: listSettingsSchema,
        opId,
        renames: z
          .array(z.strictObject({ from: propertyKeySchema, to: propertyKeySchema }))
          .max(LIST_PROPERTIES_MAX)
          .default([]),
      }),
    )
    .output(landed),

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
      [ConflictError.code]: ConflictError,
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
      containers: z.array(containerCountSchema),
      tags: z.array(tagCountSchema),
      total: count,
      unsorted: count,
      untagged: count,
      views: savedViewsSchema,
    }),
  ),

  children: signedBase
    .input(z.strictObject({ parentId: idSchema.nullable() }))
    .output(treeChildrenSchema),

  titles: signedBase.output(
    z.object({ targets: z.array(z.object({ id: idSchema, title: z.string() })) }),
  ),
};

const organizeContract = {
  outline: signedBase.output(
    z.object({
      containers: z.array(containerCountSchema),
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

const viewsContract = {
  remove: signedBase
    .input(z.strictObject({ id: idSchema, opId }))
    .output(z.object({ seq: seqSchema })),

  save: signedBase
    .errors({ [PayloadTooLargeError.code]: PayloadTooLargeError })
    .input(z.strictObject({ opId, view: savedViewSchema }))
    .output(z.object({ seq: seqSchema })),
};

export const libraryContract = {
  agent: agentContract,

  changes: signedBase
    .input(z.strictObject({ after: seqSchema.optional() }))
    .output(z.object({ head: seqSchema, moved: libraryMovedSchema.nullable() })),

  files: filesContract,

  guide: signedBase.output(z.object({ markdown: z.string() })),

  heads: signedBase.output(eventIterator(z.object({ head: seqSchema }))),

  imports: importsContract,
  items: itemsContract,
  listing: listingContract,
  organize: organizeContract,

  search: signedBase
    .input(searchInputSchema)
    .output(z.object({ cursor: nextCursor, hits: z.array(searchHitSchema) })),

  views: viewsContract,

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
