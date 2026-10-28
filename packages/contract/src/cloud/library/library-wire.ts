// The library's wire: the rows a replica pulls, the shapes a write names, what a refusal carries
// and what an agent reads. Rows and answers are `z.object`, so a field a newer cell adds is
// stripped rather than refused; requests are strict, since only the newest cell reads them. The
// persisted vocabulary inside both (an item's fields, a block) is `@repo/notes/library`'s own.
//
// A row keeps its table's times, unix milliseconds (an annotation's, unix seconds, as its entry
// keeps them); an answer an agent reads spells its times in ISO 8601, which a model reads as a
// date.

import { z } from "zod";

import { cellItemScopeSchema } from "@repo/domain/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/domain/view-context";
import {
  ANNOTATION_QUOTE_MAX,
  annotationIdSchema,
  annotationSourceSchema,
} from "@repo/notes/annotations/store-schema";
import { ITEM_KINDS } from "@repo/notes/items/item-kind";
import { blockHashSchema } from "@repo/notes/library/block-ops";
import { ordSchema } from "@repo/notes/library/block-order";
import { itemCardSchema } from "@repo/notes/library/derive-item";
import {
  libraryItemFieldsSchema,
  propertyKeySchema,
  SHA256_HEX_RE,
} from "@repo/notes/library/library-item";
import { CHANGE_SET_ACTORS } from "@repo/notes/library/library-schema";
import {
  blockIdSchema,
  libraryBlockSchema,
  librarySectionSchema,
  storableBlockSchema,
} from "@repo/notes/library/library-nodes";

// ---- ids, times and counters ----

// an item, a folder, a change set or a thread; any version, since an import may keep the id its
// file carried
export const idSchema = z.uuid();
// what a device mints for an item or folder it creates, so one made offline already has its id
export const newIdSchema = z.uuidv7();
// the outbox's key for one write, kept by the cell so a resend after a lost answer lands once
export const opIdSchema = z.uuid();
export const shaSchema = z.string().regex(SHA256_HEX_RE);
// a highlight's id is a marker's text too, so it is held to the marker alphabet and a row's length
const annotationId = annotationIdSchema.max(64);
// a Managed Agents event's own id (`sevt_…`)
export const eventIdSchema = z.string().min(1).max(128);

const instant = z.number().int().nonnegative();
const seconds = z.number().int().nonnegative();
export const seqSchema = z.number().int().nonnegative();
const isoInstant = z.iso.datetime();
export const isoDate = z.iso.date();

// the library's identity across a restore: a pull that names another starts over from nothing
export const epochSchema = z.string().min(1).max(64);
export const cursorSchema = z.string().min(1).max(512);

// ---- caps a device checks before it sends ----

// one write's ops (the item's text cap binds first), and one bulk change's items
export const WRITE_OPS_MAX = 10_000;
export const BULK_ITEMS_MAX = 100;
// a highlight's own note, and a note or link note an agent writes as markdown
export const ANNOTATION_NOTE_MAX = 20_000;
export const MARKDOWN_MAX = 1_000_000;
// a message to the built-in agent
export const MESSAGE_MAX = 20_000;
// what an agent or a list reads at once
export const PAGE_MAX = 50;

// ---- the synced rows ----

// an item's fields as an answer carries them: each one checked as stored, one a newer cell adds
// stripped
const itemFieldsRowSchema = z.object(libraryItemFieldsSchema.shape);

export const liveItemRowSchema = z.object({
  card: itemCardSchema,
  fields: itemFieldsRowSchema,
  id: idSchema,
  kind: z.literal("live"),
  seq: seqSchema,
  updatedAt: instant,
});

// an emptied item keeps its id and sequence forever, so no replica misses that it went
const purgedItemRowSchema = z.object({
  deletedAt: instant.nullable(),
  id: idSchema,
  kind: z.literal("purged"),
  seq: seqSchema,
  updatedAt: instant,
});

const itemRowSchema = z.discriminatedUnion("kind", [liveItemRowSchema, purgedItemRowSchema]);

// a folder's name is one segment of the path an agent files by, so it holds no `/`
const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !name.includes("/"), { error: "holds a /" });

const folderRowSchema = z.object({
  deletedAt: instant.nullable(),
  id: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  seq: seqSchema,
  sort: ordSchema,
});

const annotationRowSchema = z.object({
  createdAt: seconds,
  deletedAt: seconds.nullable(),
  id: annotationId,
  itemId: idSchema,
  // a root has none and a reply its root's
  parentId: annotationId.nullable(),
  // the passage's text when it was made; a reply has none
  quote: z.string().nullable(),
  occurrence: z.number().int().positive().nullable(),
  seq: seqSchema,
  source: annotationSourceSchema.nullable(),
  // "" is a bare highlight
  text: z.string(),
  updatedAt: seconds,
});

const blobRowSchema = z.object({
  bytes: z.number().int().nonnegative(),
  h: z.number().int().positive().nullable(),
  mime: z.string().min(1),
  sha: shaSchema,
  w: z.number().int().positive().nullable(),
});

// where a thread's built-in agent stands: nothing running, a send waiting on the account's one turn
// at a time, a turn running, a turn waiting on the person's approval, or stopped at the allowance
export const THREAD_STATUSES = [
  "idle",
  "queued",
  "running",
  "awaiting_approval",
  "stopped",
] as const;

export const threadRowSchema = z.object({
  createdAt: instant,
  id: idSchema,
  seq: seqSchema,
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updatedAt: instant,
});

// a Managed Agents event as the cell stored it, kept raw: an event type this build never heard of
// is a row it skips, never a pull it refuses
export const threadEventRowSchema = z.object({
  at: instant,
  event: z.json(),
  eventId: eventIdSchema,
  idx: z.number().int().nonnegative(),
  seq: seqSchema,
  threadId: idSchema,
  type: z.string().min(1),
});

// one entry of the change log: the row as it is now, or null when it is gone; a body is not a row,
// and is wanted again whenever its item's sequence moves
const changeOf = <K extends string, R extends z.ZodType>(kind: K, row: R) =>
  z.object({ id: z.string().min(1), kind: z.literal(kind), row: row.nullable(), seq: seqSchema });

export const libraryChangeSchema = z.discriminatedUnion("kind", [
  changeOf("item", itemRowSchema),
  changeOf("folder", folderRowSchema),
  changeOf("annotation", annotationRowSchema),
  changeOf("blob", blobRowSchema),
  changeOf("thread", threadRowSchema),
  changeOf("thread_event", threadEventRowSchema),
]);

// ---- bodies ----

export const storedBlockSchema = z.object({
  block: libraryBlockSchema,
  hash: blockHashSchema,
  ord: ordSchema,
  section: librarySectionSchema,
});

// a block a write creates, in its place
export const placedBlockSchema = z.strictObject({
  block: storableBlockSchema,
  ord: ordSchema,
  section: librarySectionSchema,
});

// ---- writes beside the block ops ----

const noteTextSchema = z.string().max(ANNOTATION_NOTE_MAX);

// a highlight's writes, each guarded like a block: an add lands once, an edit or a removal only
// over the note text it was computed from; who wrote it is the cell's to stamp
export const annotationOpSchema = z.discriminatedUnion("op", [
  z
    .strictObject({
      createdAt: seconds,
      id: annotationId,
      occurrence: z.number().int().positive().nullable(),
      op: z.literal("add"),
      parentId: annotationId.nullable(),
      quote: z.string().min(1).max(ANNOTATION_QUOTE_MAX).nullable(),
      text: noteTextSchema,
    })
    .refine((op) => (op.quote === null) !== (op.parentId === null), {
      error: "a highlight has a quote and no parent, a reply a parent and no quote",
    }),
  z.strictObject({
    base: noteTextSchema,
    id: annotationId,
    op: z.literal("note"),
    text: noteTextSchema,
  }),
  z.strictObject({ base: noteTextSchema, id: annotationId, op: z.literal("remove") }),
]);

export const folderOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    id: newIdSchema,
    name: folderNameSchema,
    op: z.literal("create"),
    parentId: idSchema.nullable(),
    sort: ordSchema,
  }),
  z.strictObject({
    base: z.string(),
    id: idSchema,
    name: folderNameSchema,
    op: z.literal("rename"),
  }),
  z.strictObject({
    baseParentId: idSchema.nullable(),
    id: idSchema,
    op: z.literal("move"),
    parentId: idSchema.nullable(),
    sort: ordSchema,
  }),
  z.strictObject({ id: idSchema, op: z.literal("delete") }),
]);

// ---- what a refusal carries ----

// what a write's base met instead, one entry per guarded thing: a block (null when it is gone), a
// block's place, a field's value, a property (absent when unset), a highlight, a folder, or an
// item whose sequence moved past the one an edit was read at
export const conflictCurrentSchema = z.discriminatedUnion("kind", [
  z.object({
    blockId: blockIdSchema,
    current: storedBlockSchema.nullable(),
    itemId: idSchema,
    kind: z.literal("block"),
  }),
  z.object({
    blockId: blockIdSchema,
    currentOrd: ordSchema,
    itemId: idSchema,
    kind: z.literal("order"),
  }),
  z.object({
    current: z.json(),
    field: libraryItemFieldsSchema.keyof(),
    itemId: idSchema,
    kind: z.literal("field"),
  }),
  z.object({
    current: z.json().optional(),
    itemId: idSchema,
    key: propertyKeySchema,
    kind: z.literal("property"),
  }),
  z.object({
    current: annotationRowSchema.nullable(),
    id: annotationId,
    itemId: idSchema,
    kind: z.literal("annotation"),
  }),
  z.object({ current: folderRowSchema.nullable(), id: idSchema, kind: z.literal("folder") }),
  z.object({ itemId: idSchema, kind: z.literal("item"), seq: seqSchema }),
]);

// why an agent's edit cannot land: an `old_text` that is empty, stands nowhere or stands more than
// once, or a change to the lines the article opens and closes on, or nesting deeper than the
// editor reads; `edit` is its index in the request
export const editRefusalSchema = z.object({
  count: z.number().int().positive().optional(),
  edit: z.number().int().nonnegative(),
  reason: z.enum(["empty", "missing", "ambiguous", "section", "too-deep"]),
});

// ---- what an agent reads ----

// concise answers carry ids and names; detailed ones every field a person would read
export const responseFormatSchema = z.enum(["concise", "detailed"]);

const itemKindSchema = z.enum(ITEM_KINDS);

export const itemSummarySchema = z.object({
  folderId: idSchema.nullable(),
  id: idSchema,
  kind: itemKindSchema,
  pinned: z.boolean(),
  preview: z.string().optional(),
  savedAt: isoInstant,
  site: z.string().nullable().optional(),
  tags: z.array(z.string()),
  title: z.string(),
  url: z.string().nullable(),
});

export const searchHitSchema = z.object({
  id: idSchema,
  kind: itemKindSchema,
  savedAt: isoInstant,
  snippet: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

const linkedItemSchema = z.object({ id: idSchema, title: z.string() });

export const itemReadSchema = z.object({
  fields: z.object({
    aliases: z.array(z.string()).optional(),
    author: z.string().nullable(),
    deletedAt: isoInstant.nullable(),
    description: z.string().nullable(),
    fetchError: z.string().nullable(),
    fetchState: libraryItemFieldsSchema.shape.fetchState,
    folderId: idSchema.nullable(),
    kind: itemKindSchema,
    pinned: z.boolean(),
    properties: z.record(z.string(), z.json()).optional(),
    published: z.string().nullable(),
    savedAt: isoInstant,
    site: z.string().nullable(),
    tags: z.array(z.string()),
    title: z.string(),
    url: z.string().nullable(),
  }),
  highlights: z.number().int().nonnegative(),
  id: idSchema,
  links: z.object({ in: z.array(linkedItemSchema), out: z.array(linkedItemSchema) }),
  // the sequence an edit names as its base
  seq: seqSchema,
  // a run of the item's blocks as dialect markdown, its links written `[[Title|id]]`; `from` and
  // `to` are block positions in reading order, so the next page starts at `to`
  view: z.object({
    from: z.number().int().nonnegative(),
    markdown: z.string(),
    to: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

export const highlightSchema = z.object({
  createdAt: isoInstant,
  id: annotationId,
  itemId: idSchema,
  itemTitle: z.string(),
  // the passage is in the item's text; an unplaced one is listed under the item
  placed: z.boolean(),
  quote: z.string().nullable(),
  replies: z.array(z.object({ createdAt: isoInstant, id: annotationId, text: z.string() })),
  text: z.string(),
});

export const changeSetSchema = z.object({
  actor: z.enum(CHANGE_SET_ACTORS),
  closedAt: isoInstant.nullable(),
  id: idSchema,
  items: z.array(
    z.object({
      created: z.boolean(),
      deleted: z.boolean(),
      id: idSchema,
      // the item's revision when the set closed, which `history.revision` reads
      rev: z.number().int().positive().nullable(),
      title: z.string(),
    }),
  ),
  // who in words: "You on this Mac", "Claude", "Raindrop import"
  label: z.string(),
  openedAt: isoInstant,
  undoneBy: idSchema.nullable(),
});

// ---- what the built-in agent is asked from ----

// the screen a message left from, by id: an open item and what was selected in it, or the library
// grid's scope, filters and selection. It rides the message, never the thread, so it cannot go
// stale
export const agentViewContextSchema = z.discriminatedUnion("surface", [
  z.strictObject({
    itemId: idSchema,
    selection: z.string().min(1).max(ANNOTATION_QUOTE_MAX).optional(),
    surface: z.literal("item"),
  }),
  z.strictObject({
    // the first selected; [] when nothing is
    itemIds: z.array(idSchema).max(LIBRARY_SELECTION_MAX),
    kinds: z.array(itemKindSchema).min(1).optional(),
    q: z.string().min(1).max(500).optional(),
    scope: cellItemScopeSchema,
    // how many are selected, which may exceed itemIds.length
    selected: z.number().int().nonnegative(),
    surface: z.literal("library"),
  }),
]);
