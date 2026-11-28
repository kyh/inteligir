import { z } from "zod";

import { itemScopeSchema, LIBRARY_SELECTION_MAX, libraryScopeSchema } from "../library-scope";
import { CONTAINER_KINDS, ITEM_KINDS } from "../items/item-kind";
import { utf8ByteLength } from "../bytes";
import { itemCardSchema } from "./derive-item";
import { instant, libraryItemFieldsSchema } from "./library-item";
import { libraryBlockSchema, librarySectionSchema, storableBlockSchema } from "./library-nodes";
import { listingSortSchema } from "./listing-sort";

export const idSchema = z.uuid();
export const newIdSchema = z.uuidv7();
export const opIdSchema = z.uuid();
const eventIdSchema = z.string().min(1).max(128);

export const seqSchema = z.number().int().nonnegative();
const isoInstant = z.iso.datetime();
export const isoDate = z.iso.date();
export const count = z.number().int().nonnegative();

export const cursorSchema = z.number().int().nonnegative();

export const WRITE_OPS_MAX = 10_000;
export const BULK_ITEMS_MAX = 100;
export const MARKDOWN_MAX = 1_000_000;
export const BODY_MAX_BYTES = 1024 * 1024;
export const bodyBytes = (blocks: readonly unknown[]) => utf8ByteLength(JSON.stringify(blocks));
const AGENT_SELECTION_MAX = 4000;
export const MESSAGE_MAX = 20_000;
export const FILING_RULES_MAX = 65_536;

export const modelKeySchema = z
  .string()
  .trim()
  .regex(/^sk-ant-[\w-]{20,300}$/u, "That isn't an Anthropic key: one starts with sk-ant-.");

export const PAGE_MAX = 50;
export const LISTING_PAGE_MAX = 1000;

const itemFieldsRowSchema = z.object(libraryItemFieldsSchema.shape);

export const liveItemRowSchema = z.object({
  card: itemCardSchema,
  fields: itemFieldsRowSchema,
  id: idSchema,
  seq: seqSchema,
  updatedAt: instant,
});

export const FOLDER_NAME_MAX = 255;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(FOLDER_NAME_MAX)
  .refine((name) => !name.includes("/"), { error: "holds a /" });

export const folderPathNames = (path: string) =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter((name) => name !== "");

export const THREAD_STATUSES = ["idle", "running"] as const;

export const threadRowSchema = z.object({
  createdAt: instant,
  id: idSchema,
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updatedAt: instant,
});

export const threadEventRowSchema = z.object({
  at: instant,
  event: z.json(),
  eventId: eventIdSchema,
  threadId: idSchema,
  type: z.string().min(1),
});

export const threadStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), row: threadEventRowSchema }),
  z.object({ kind: z.literal("draft"), text: z.string() }),
  z.object({ kind: z.literal("caughtUp") }),
]);

export const libraryMovedSchema = z.object({
  tree: z.boolean(),
  items: z.union([z.literal("all"), z.array(z.object({ id: idSchema, seq: seqSchema }))]),
  threads: z.union([z.literal("all"), z.array(idSchema)]),
});

export const bodyBlockSchema = z.object({
  block: libraryBlockSchema,
  section: librarySectionSchema,
});

export const newBodyBlockSchema = z.strictObject({
  block: storableBlockSchema,
  section: librarySectionSchema,
});

export const bodyVersionSchema = z.number().int().positive();

export const bodyWriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), seq: seqSchema, version: bodyVersionSchema }),
  z.object({ kind: z.literal("stale"), version: bodyVersionSchema }),
  z.object({ kind: z.literal("full"), maxBytes: z.number().int().positive() }),
  z.object({ kind: z.literal("deleted") }),
]);

const editIndex = z.number().int().nonnegative();

export const editRefusalSchema = z.discriminatedUnion("kind", [
  z.object({ edit: editIndex, kind: z.enum(["missing", "section", "too-deep", "unstorable"]) }),
  z.object({ count: z.number().int().positive(), edit: editIndex, kind: z.literal("ambiguous") }),
]);

const itemKindSchema = z.enum(ITEM_KINDS);

export const kindsSchema = z.array(itemKindSchema).min(1);

export const listingPageInputSchema = z.strictObject({
  cursor: cursorSchema.default(0),
  kinds: kindsSchema.optional(),
  limit: z.number().int().min(1).max(LISTING_PAGE_MAX),
  meaning: z.boolean().default(false),
  scope: libraryScopeSchema,
  sort: listingSortSchema.default("saved"),
  words: z.string().trim().min(1).max(500).optional(),
});

export const sweptSchema = z.strictObject({
  except: z.array(idSchema).max(LISTING_PAGE_MAX),
  kinds: kindsSchema.optional(),
  scope: libraryScopeSchema,
});

export const containerCountSchema = z.object({
  id: idSchema,
  items: count,
  kind: z.enum(CONTAINER_KINDS),
  parentId: idSchema.nullable(),
  title: z.string(),
});

const treeChildSchema = z.object({
  hasChildren: z.boolean(),
  id: idSchema,
  kind: itemKindSchema,
  title: z.string(),
});

export const TREE_CHILDREN_MAX = 500;

export const treeChildrenSchema = z.object({
  children: z.array(treeChildSchema),
  more: z.boolean(),
});

export const tagCountSchema = z.object({ items: count, tag: z.string() });

export const listedItemSchema = z.object({
  card: itemCardSchema,
  fields: itemFieldsRowSchema,
  id: idSchema,
  seq: seqSchema,
  snippet: z.string().optional(),
  tags: z.array(z.string()),
  updatedAt: instant,
});

export const responseFormatSchema = z.enum(["concise", "detailed"]);

export const itemSummarySchema = z.object({
  parentId: idSchema.nullable(),
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
    parentId: idSchema.nullable(),
    kind: itemKindSchema,
    pinned: z.boolean(),
    properties: z.record(z.string(), z.json()).optional(),
    published: z.string().nullable(),
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
  view: z.object({
    from: z.number().int().nonnegative(),
    markdown: z.string(),
    to: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

export const agentViewContextSchema = z.discriminatedUnion("surface", [
  z.strictObject({
    itemId: idSchema,
    selection: z.string().min(1).max(AGENT_SELECTION_MAX).optional(),
    surface: z.literal("item"),
  }),
  z.strictObject({
    itemIds: z.array(idSchema).max(LIBRARY_SELECTION_MAX),
    kinds: kindsSchema.optional(),
    q: z.string().min(1).max(500).optional(),
    scope: itemScopeSchema,
    selected: z.number().int().nonnegative(),
    surface: z.literal("library"),
  }),
]);

export const IMPORT_STANDINGS = ["held", "deleted", "new"] as const;
