// The library's wire: the rows the apps read, the shapes a write names, what a refusal carries
// and what an agent reads. Rows and answers are `z.object`, so a field a newer cell adds is
// stripped rather than refused; requests are strict, since only the newest cell reads them. The
// persisted vocabulary inside both (an item's fields, a block) is `./library-item`'s and
// `./library-nodes`' own.
//
// A row keeps its table's times, unix milliseconds; an answer an agent reads spells its times in
// ISO 8601, which a model reads as a date.

import { z } from "zod";

import { itemScopeSchema, LIBRARY_SELECTION_MAX, libraryScopeSchema } from "../library-scope";
import { ITEM_KINDS } from "../items/item-kind";
import { ordSchema } from "./order-key";
import { itemCardSchema } from "./derive-item";
import { libraryItemFieldsSchema, SHA256_HEX_RE } from "./library-item";
import { libraryBlockSchema, librarySectionSchema, storableBlockSchema } from "./library-nodes";

// ---- ids, times and counters ----

// an item, a folder, a change set or a thread; any version, since an import may keep the id its
// file carried
export const idSchema = z.uuid();
// what a device mints for an item or folder it creates, so a save that waits already has its id
export const newIdSchema = z.uuidv7();
// one write's key, kept by the cell so a resend after a lost answer lands once
export const opIdSchema = z.uuid();
export const shaSchema = z.string().regex(SHA256_HEX_RE);
// a thread event's id: `<session>:<line>:<index>`, where the agent's runtime recorded the fact it
// shows, by the number of the thread's session it ran in and its place there. Ids only grow, so a
// reader resumes after the last one it holds
const eventIdSchema = z.string().min(1).max(128);

const instant = z.number().int().nonnegative();
export const seqSchema = z.number().int().nonnegative();
const isoInstant = z.iso.datetime();
export const isoDate = z.iso.date();
const count = z.number().int().nonnegative();

// a list's place: a page starts at the position the last one ended at, and an answer's is where
// the next page starts, null once the list ends
export const cursorSchema = z.number().int().nonnegative();

// ---- caps a device checks before it sends ----

// one write's ops (the item's text cap binds first), and one bulk change's items
export const WRITE_OPS_MAX = 10_000;
export const BULK_ITEMS_MAX = 100;
// a note or link note an agent writes as markdown
export const MARKDOWN_MAX = 1_000_000;
// a body's blocks, as the UTF-8 bytes of their JSON. Every save writes the whole body and derives
// its search row again, which past 1 MiB holds a save over a second on a Vercel function; it also
// leaves room in a function's 4.5 MB request for the call around the blocks
export const BODY_MAX_BYTES = 1024 * 1024;
// the passage selected in the item a message to the built-in agent leaves from
const AGENT_SELECTION_MAX = 4000;
// a message to the built-in agent
export const MESSAGE_MAX = 20_000;
// the person's filing rules, which every turn of the built-in agent is sent under, after its
// prompt: a few pages of prose at most
export const FILING_RULES_MAX = 65_536;
// what an agent or a list reads at once
export const PAGE_MAX = 50;
// what one page of the apps' listing carries, and the most a sweep leaves out
const LISTING_PAGE_MAX = 1000;

// ---- the rows ----

// an item's fields as an answer carries them: each one checked as stored, one a newer cell adds
// stripped
const itemFieldsRowSchema = z.object(libraryItemFieldsSchema.shape);

export const liveItemRowSchema = z.object({
  card: itemCardSchema,
  fields: itemFieldsRowSchema,
  id: idSchema,
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

// where a thread's built-in agent stands: waiting for the next message, or a turn running, which a
// message sent meanwhile joins. A turn the allowance stopped leaves its thread idle, and the next
// send goes on with it
export const THREAD_STATUSES = ["idle", "running"] as const;

export const threadRowSchema = z.object({
  createdAt: instant,
  id: idSchema,
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updatedAt: instant,
});

// an event of the thread, one of `./agent-events`' union as JSON: an event this build cannot parse
// is a row a reader skips, never a stream it refuses
export const threadEventRowSchema = z.object({
  at: instant,
  event: z.json(),
  eventId: eventIdSchema,
  threadId: idSchema,
  type: z.string().min(1),
});

// What following a thread streams, under one id per row, its `eventId`, which a reconnect sends back
// as its last: the thread's events, then once a connection where those it kept end (`caughtUp`),
// then each as it happens. A `draft` is a piece of the agent's text as it is written, never kept
// and carrying no id: it adds to the draft since the last row, and the next row ends the draft
export const threadStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), row: threadEventRowSchema }),
  z.object({ kind: z.literal("draft"), text: z.string() }),
  z.object({ kind: z.literal("caughtUp") }),
]);

// what moved in the library after a head a device holds, so it reads again only what it shows of
// that: each item at the sequence it now holds, one emptied from Deleted too, whether any folder
// moved, and which threads did; "all" where more moved than a list names. No client bounds the
// lists, so the cloud may raise its cap
export const libraryMovedSchema = z.object({
  folders: z.boolean(),
  items: z.union([z.literal("all"), z.array(z.object({ id: idSchema, seq: seqSchema }))]),
  threads: z.union([z.literal("all"), z.array(idSchema)]),
});

// ---- bodies ----

// a top-level block of an item's body as a read answers it, in reading order
export const bodyBlockSchema = z.object({
  block: libraryBlockSchema,
  section: librarySectionSchema,
});

// a block of the body a write makes, in the order it is sent
export const newBodyBlockSchema = z.strictObject({
  block: storableBlockSchema,
  section: librarySectionSchema,
});

// a body's version: 1 as its item is made, one more with every write of its blocks and only then
export const bodyVersionSchema = z.number().int().positive();

// what a body's save answers: `saved` at its new version, beside the item's seq; `stale`, someone
// saved since the version it was made over, at the version they made; `full`, past the most a body
// holds; `deleted`, its item in Deleted, which takes no edit
export const bodyWriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), seq: seqSchema, version: bodyVersionSchema }),
  z.object({ kind: z.literal("stale"), version: bodyVersionSchema }),
  z.object({ kind: z.literal("full"), maxBytes: z.number().int().positive() }),
  z.object({ kind: z.literal("deleted") }),
]);

// ---- writes beside a property's ops ----

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

const editIndex = z.number().int().nonnegative();

// why an agent's edit cannot land, `edit` its index in the request: an `old_text` that stands
// nowhere in the note or more than once, one that reaches the article, or new text that nests
// deeper than the editor reads or that no block can store
export const editRefusalSchema = z.discriminatedUnion("kind", [
  z.object({ edit: editIndex, kind: z.enum(["missing", "section", "too-deep", "unstorable"]) }),
  z.object({ count: z.number().int().positive(), edit: editIndex, kind: z.literal("ambiguous") }),
]);

// ---- what the apps list ----

const itemKindSchema = z.enum(ITEM_KINDS);

// the orders a list is browsed in: newest saved, last changed, or by title
export const listingSortSchema = z.enum(["saved", "modified", "title"]);
export const kindsSchema = z.array(itemKindSchema).min(1);

// a page of the items a scope lists, from `cursor`, narrowed to `kinds`: in the `sort` order, or
// with `words` only what a search of the scope's side (the library, or Deleted) finds, best first
export const listingPageInputSchema = z.strictObject({
  cursor: cursorSchema.default(0),
  kinds: kindsSchema.optional(),
  limit: z.number().int().min(1).max(LISTING_PAGE_MAX),
  scope: libraryScopeSchema,
  sort: listingSortSchema.default("saved"),
  words: z.string().trim().min(1).max(500).optional(),
});

// what a sweep takes: every item a scope lists, narrowed to `kinds`, but those left out
export const sweptSchema = z.strictObject({
  except: z.array(idSchema).max(LISTING_PAGE_MAX),
  kinds: kindsSchema.optional(),
  scope: libraryScopeSchema,
});

// a live folder with the items in it and under it, and a tag with the items carrying it
export const folderCountSchema = z.object({
  id: idSchema,
  items: count,
  name: z.string(),
  parentId: idSchema.nullable(),
  sort: z.string(),
});
export const tagCountSchema = z.object({ items: count, tag: z.string() });

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
    folderId: idSchema.nullable(),
    kind: itemKindSchema,
    pinned: z.boolean(),
    properties: z.record(z.string(), z.json()).optional(),
    published: z.string().nullable(),
    // where a link's page reading stands: `pending` until the library reads it, `failed` with why
    reading: z.discriminatedUnion("state", [
      z.object({ state: z.literal("none") }),
      z.object({ at: isoInstant.nullable(), state: z.literal("pending") }),
      z.object({ at: isoInstant, state: z.literal("read") }),
      z.object({ at: isoInstant.nullable(), error: z.string(), state: z.literal("failed") }),
    ]),
    savedAt: isoInstant,
    site: z.string().nullable(),
    tags: z.array(z.string()),
    title: z.string(),
    url: z.string().nullable(),
  }),
  id: idSchema,
  links: z.object({ in: z.array(linkedItemSchema), out: z.array(linkedItemSchema) }),
  // a run of the item's blocks as dialect markdown, its links written `[Title](mention:<id>)`; `from` and
  // `to` are block positions in reading order, so the next page starts at `to`
  view: z.object({
    from: z.number().int().nonnegative(),
    markdown: z.string(),
    to: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
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
    kinds: kindsSchema.optional(),
    q: z.string().min(1).max(500).optional(),
    scope: itemScopeSchema,
    // how many are selected, which may exceed itemIds.length
    selected: z.number().int().nonnegative(),
    surface: z.literal("library"),
  }),
]);

// ---- imports ----

// what a device reads into the library: a Raindrop export, or a folder of markdown zipped,
// Obsidian's included
export const IMPORT_SOURCES = ["raindrop", "markdown"] as const;

// how a note an import planned stands in the library: an item it holds by the note's id or
// address, one in Deleted, or one still to land
export const IMPORT_STANDINGS = ["held", "deleted", "new"] as const;
