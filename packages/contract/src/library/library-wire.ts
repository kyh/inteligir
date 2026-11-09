// The library's wire: the rows the apps read, the shapes a write names, what a refusal carries
// and what an agent reads. Rows and answers are `z.object`, so a field a newer cell adds is
// stripped rather than refused; requests are strict, since only the newest cell reads them. The
// persisted vocabulary inside both (an item's fields, a block) is `./library-item`'s and
// `./library-nodes`' own.
//
// A row keeps its table's times, unix milliseconds; an answer an agent reads spells its times in
// ISO 8601, which a model reads as a date.

import { z } from "zod";

import { itemScopeSchema, LIBRARY_SELECTION_MAX } from "../library-scope";
import { ITEM_KINDS } from "../items/item-kind";
import { blockHashSchema } from "./block-ops";
import { ordSchema } from "./order-key";
import { itemCardSchema } from "./derive-item";
import { libraryItemFieldsSchema, propertyKeySchema, SHA256_HEX_RE } from "./library-item";
import {
  blockIdSchema,
  libraryBlockSchema,
  librarySectionSchema,
  storableBlockSchema,
} from "./library-nodes";

// ---- ids, times and counters ----

// an item, a folder, a change set or a thread; any version, since an import may keep the id its
// file carried
export const idSchema = z.uuid();
// what a device mints for an item or folder it creates, so a save that waits already has its id
export const newIdSchema = z.uuidv7();
// one write's key, kept by the cell so a resend after a lost answer lands once
export const opIdSchema = z.uuid();
export const shaSchema = z.string().regex(SHA256_HEX_RE);
// a thread event's id: `<threadId>:<push>:<index>` for what its conversation's object pushed, by
// that push's sequence and the event's place in it, and `<threadId>:turn:<turn>` for the person's
// message that opened a turn
export const eventIdSchema = z.string().min(1).max(128);

const instant = z.number().int().nonnegative();
export const seqSchema = z.number().int().nonnegative();
const isoInstant = z.iso.datetime();
export const isoDate = z.iso.date();

export const cursorSchema = z.string().min(1).max(512);

// ---- caps a device checks before it sends ----

// one write's ops (the item's text cap binds first), and one bulk change's items
export const WRITE_OPS_MAX = 10_000;
export const BULK_ITEMS_MAX = 100;
// a note or link note an agent writes as markdown
export const MARKDOWN_MAX = 1_000_000;
// the passage selected in the item a message to the built-in agent leaves from
const AGENT_SELECTION_MAX = 4000;
// a message to the built-in agent
export const MESSAGE_MAX = 20_000;
// the person's filing rules, which ride every conversation with the built-in agent as a system
// message: a few pages of prose at most
export const FILING_RULES_MAX = 65_536;
// what an agent or a list reads at once
export const PAGE_MAX = 50;
// what one page of the apps' listing carries
export const LISTING_PAGE_MAX = 1000;

// ---- the rows ----

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

export const FOLDER_NAME_MAX = 255;

// a folder's name is one segment of the path an agent files by, so it holds no `/`
export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(FOLDER_NAME_MAX)
  .refine((name) => !name.includes("/"), { error: "holds a /" });

// the folder names a path joined by `/` names from the top, its blank segments skipped
export const folderPathNames = (path: string): string[] =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter((name) => name !== "");

export const folderRowSchema = z.object({
  deletedAt: instant.nullable(),
  id: idSchema,
  name: z.string(),
  parentId: idSchema.nullable(),
  seq: seqSchema,
  sort: ordSchema,
});

// where a thread's built-in agent stands: nothing running, a send waiting for its thread's turn or
// for one of the account's, a turn running, or a turn waiting on the person's approval. A turn the
// allowance stopped leaves its thread idle, and the next send goes on with it
export const THREAD_STATUSES = ["idle", "queued", "running", "awaiting_approval"] as const;

export const threadRowSchema = z.object({
  createdAt: instant,
  id: idSchema,
  seq: seqSchema,
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updatedAt: instant,
});

// an event of the thread as the cell stored it, one of `./agent-events`' union kept as JSON: an
// event this build cannot parse is a row a reader skips, never a page it refuses
export const threadEventRowSchema = z.object({
  at: instant,
  event: z.json(),
  eventId: eventIdSchema,
  idx: z.number().int().nonnegative(),
  seq: seqSchema,
  threadId: idSchema,
  type: z.string().min(1),
});

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
// block's place, a field's value, a property (absent when unset), a folder, or an item whose
// sequence moved past the one an edit was read at
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
  z.object({ current: folderRowSchema.nullable(), id: idSchema, kind: z.literal("folder") }),
  z.object({ itemId: idSchema, kind: z.literal("item"), seq: seqSchema }),
]);

// why an agent's edit cannot land: an `old_text` that is empty, stands nowhere or stands more than
// once, a change to the lines the article opens and closes on, nesting deeper than the editor
// reads, or text no block can store; `edit` is its index in the request
export const editRefusalSchema = z.object({
  count: z.number().int().positive().optional(),
  edit: z.number().int().nonnegative(),
  reason: z.enum(["empty", "missing", "ambiguous", "section", "too-deep", "unstorable"]),
});

// ---- what the apps list ----

// which items a listing shows, as `@repo/contract/library/library-index` answers it: the library or
// Deleted, narrowed by kind, tag (and every tag under it), folder (or none, for Unsorted), site and
// saved time
export const listingQuerySchema = z.strictObject({
  beforeMs: instant.optional(),
  deleted: z.boolean(),
  folderId: idSchema.nullable().optional(),
  kinds: z.array(z.enum(ITEM_KINDS)).optional(),
  sinceMs: instant.optional(),
  site: z.string().trim().min(1).max(253).optional(),
  sort: z.enum(["saved", "modified", "title", "relevance"]),
  subfolders: z.boolean().optional(),
  tag: libraryItemFieldsSchema.shape.tags.element.optional(),
  untagged: z.boolean().optional(),
});

// an item as a listing draws it: its row, every tag it carries (its field's and its body's), and
// under a search the passage that matched
export const listedItemSchema = z.object({
  card: itemCardSchema,
  fields: itemFieldsRowSchema,
  id: idSchema,
  seq: seqSchema,
  snippet: z.string().optional(),
  tags: z.array(z.string()),
  updatedAt: instant,
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
  id: idSchema,
  links: z.object({ in: z.array(linkedItemSchema), out: z.array(linkedItemSchema) }),
  // the sequence an edit names as its base
  seq: seqSchema,
  // a run of the item's blocks as dialect markdown, its links written `[Title](mention:<id>)`; `from` and
  // `to` are block positions in reading order, so the next page starts at `to`
  view: z.object({
    from: z.number().int().nonnegative(),
    markdown: z.string(),
    to: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

// who a change set is by: the person, the built-in agent, a connected assistant, an import, the
// cloud reading a page, or an undo
export const CHANGE_SET_ACTORS = [
  "person",
  "agent",
  "assistant",
  "import",
  "fill",
  "undo",
] as const;

export const changeSetSchema = z.object({
  actor: z.enum(CHANGE_SET_ACTORS),
  closedAt: isoInstant.nullable(),
  id: idSchema,
  // how many items the set changed; `items` names the first of them, at most a page
  itemCount: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      created: z.boolean(),
      deleted: z.boolean(),
      id: idSchema,
      title: z.string(),
    }),
  ),
  // who in words: "You on this Mac", "Claude", "Raindrop import"
  label: z.string(),
  openedAt: isoInstant,
  // the conversation and turn of the built-in agent's that made it; null for every other writer
  threadId: idSchema.nullable(),
  turn: z.number().int().positive().nullable(),
  undoneBy: idSchema.nullable(),
});

// ---- what the built-in agent is asked from ----

// the screen a message left from, by id: an open item and what was selected in it, or the library
// grid's scope, filters and selection. It rides the message, never the thread, so it cannot go
// stale
export const agentViewContextSchema = z.discriminatedUnion("surface", [
  z.strictObject({
    itemId: idSchema,
    selection: z.string().min(1).max(AGENT_SELECTION_MAX).optional(),
    surface: z.literal("item"),
  }),
  z.strictObject({
    // the first selected; [] when nothing is
    itemIds: z.array(idSchema).max(LIBRARY_SELECTION_MAX),
    kinds: z.array(itemKindSchema).min(1).optional(),
    q: z.string().min(1).max(500).optional(),
    scope: itemScopeSchema,
    // how many are selected, which may exceed itemIds.length
    selected: z.number().int().nonnegative(),
    surface: z.literal("library"),
  }),
]);

// ---- imports ----

// what an import reads (a Raindrop export, a folder of markdown zipped, Obsidian's included), where
// a job stands, and the phase a running one is in: reading the file into its plan, landing its
// items a page at a time, then the files no item embedded as items of their own
export const IMPORT_SOURCES = ["raindrop", "markdown"] as const;
export const IMPORT_STATES = ["running", "done", "failed", "cancelled"] as const;
export const IMPORT_PHASES = ["reading", "landing", "files"] as const;

const count = z.number().int().nonnegative();

// an import as it runs and once it ended: what it found, what it added, what the library already
// held by its address, what it left out and why, and the change set it landed in
export const importJobSchema = z.object({
  added: count,
  alreadySaved: count,
  changeSetId: idSchema.nullable(),
  finishedAt: instant.nullable(),
  id: idSchema,
  // why a job failed, in a sentence the person reads
  message: z.string().nullable(),
  // what the import leaves out by its rules: a bookmark with no web address or one in the bin, and
  // a path no item is made of (Obsidian's settings, another dot-folder's)
  skipped: count,
  source: z.enum(IMPORT_SOURCES),
  startedAt: instant,
  state: z.enum(IMPORT_STATES),
  total: count,
  // what could not be read into an item: a note nested past what the editor reads or past what an
  // item holds, a zip entry that would not open, an item the library refused
  unreadable: count,
});
