// the item schemas every library surface shares; each row mirrors an engine type in
// @repo/notes/items, held equal by the engine-mirror test.

import { ITEM_KINDS, WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { parseItemTime } from "@repo/notes/items/item-time";
import { isWebUrl } from "@repo/notes/items/item-url";
import { isTagName, TAG_NAME_RULE } from "@repo/notes/knowledge/tag-grammar";
import { z } from "zod";
import { CAPTURE_HTML_MAX_CHARS } from "../../browser/browser-wire";
import { vaultPathSchema } from "../vault/vault-schema";

// spelled in @repo/notes/items/item-kind, since the phone reaches no /local module; re-exported
// here for every /local client
export { fileTooLargeMessage, WEB_URL_RULE } from "@repo/notes/items/item-kind";

export const itemKindSchema = z.enum(ITEM_KINDS);
export const itemSortSchema = z.enum(["saved", "modified", "title", "relevance"]);
// "" is the library root
export const libraryFolderSchema = z.union([z.literal(""), vaultPathSchema]);
export const webUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .refine(isWebUrl, { message: WEB_URL_RULE });
export const itemTimeSchema = z.string().refine((v) => parseItemTime(v) !== null, {
  message: "an ISO date or time, e.g. 2026-10-16 or 2026-10-16T09:00:00Z",
});

// the inline grammar's own name rule, so a rename or a save can only write a tag the scan would
// read back. spelled here rather than in knowledge-schema, which imports this module: the other
// direction is a cycle that evaluates to undefined
export const tagNameSchema = z.string().refine(isTagName, { message: TAG_NAME_RULE });

export const ITEM_TAGS_MAX = 20;
export const itemTagsSchema = z.array(tagNameSchema).max(ITEM_TAGS_MAX);

export const itemRowSchema = z.strictObject({
  author: z.string().nullable(),
  // a media file no doc embeds, listed as its own card
  bare: z.boolean(),
  // the page copy's vault path
  copy: z.string().min(1).nullable(),
  // an image's vault path
  cover: z.string().min(1).nullable(),
  description: z.string().nullable(),
  fetchError: z.string().nullable(),
  // formatItemTime, canonical
  fetched: z.string().nullable(),
  // the original's vault path (file kinds)
  file: z.string().min(1).nullable(),
  fileBytes: z.number().int().min(0).nullable(),
  // dirnamePath(path), "" for the root
  folder: z.string(),
  host: z.string().nullable(),
  kind: itemKindSchema,
  modifiedMs: z.number().nullable(),
  path: z.string().min(1),
  // isItemStub
  pending: z.boolean(),
  pinned: z.boolean(),
  // first paragraph's text, ≤140, "" when none
  preview: z.string(),
  published: z.string().nullable(),
  // formatItemTime(savedMs), canonical
  saved: z.string().nullable(),
  site: z.string().nullable(),
  tags: z.array(z.string()),
  // docStem(path); a bare file's basename without its extension
  title: z.string(),
  url: z.string().nullable(),
});
export type ItemRowWire = z.infer<typeof itemRowSchema>;

// what a save answers about the item's text
export const itemFillSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({ state: z.literal("filled") }),
  z.strictObject({ message: z.string().min(1), state: z.literal("failed") }),
]);
export type ItemFill = z.infer<typeof itemFillSchema>;

export const itemSaveResponseSchema = z.strictObject({
  // for "exists", the existing item's state
  fill: itemFillSchema,
  outcome: z.enum(["created", "exists"]),
  path: z.string().min(1),
});
export type ItemSaveResponse = z.infer<typeof itemSaveResponseSchema>;

export const itemsSaveLinkRequestSchema = z.strictObject({
  // default UNSORTED_FOLDER
  folder: libraryFolderSchema.optional(),
  // "Keep a copy of the page"
  keepCopy: z.boolean().default(false),
  tags: itemTagsSchema.optional(),
  // a title the caller already has (the drag of a link with text)
  title: z.string().trim().min(1).max(2000).optional(),
  url: webUrlSchema,
  // true: answer after the fill (at most 60 s), as the CLI asks
  wait: z.boolean().default(false),
});
export type ItemsSaveLinkRequest = z.infer<typeof itemsSaveLinkRequestSchema>;

export const capturedPageSchema = z.strictObject({
  // null: too big or not scriptable, so the Mac fetches the url
  html: z.string().max(CAPTURE_HTML_MAX_CHARS).nullable(),
  selection: z.strictObject({ text: z.string().trim().min(1).max(20_000) }).nullable(),
  title: z.string().max(2000),
  url: webUrlSchema,
});
export type CapturedPage = z.infer<typeof capturedPageSchema>;

export const itemsSavePageRequestSchema = z.strictObject({
  folder: libraryFolderSchema.optional(),
  keepCopy: z.boolean().default(false),
  page: capturedPageSchema,
  tags: itemTagsSchema.optional(),
  wait: z.boolean().default(false),
});
export type ItemsSavePageRequest = z.infer<typeof itemsSavePageRequestSchema>;

export const itemsSaveFileRequestSchema = z.strictObject({
  file: z.instanceof(Blob).refine((f) => f.size > 0, "a file holds no bytes"),
  folder: libraryFolderSchema.optional(),
  // the original's basename
  name: z.string().trim().min(1).max(255),
  tags: itemTagsSchema.optional(),
  // where it came from (an image saved from a page)
  url: webUrlSchema.optional(),
});
export type ItemsSaveFileRequest = z.infer<typeof itemsSaveFileRequestSchema>;

export const itemsRefreshRequestSchema = z.strictObject({
  keepCopy: z.boolean().default(false),
  path: vaultPathSchema,
  text: z.enum(["keep", "replace"]).default("keep"),
  wait: z.boolean().default(true),
});
export type ItemsRefreshRequest = z.infer<typeof itemsRefreshRequestSchema>;

export const itemsRefreshResponseSchema = z.strictObject({
  fill: itemFillSchema,
  path: z.string().min(1),
});
export type ItemsRefreshResponse = z.infer<typeof itemsRefreshResponseSchema>;

export const ITEMS_TAG_PATHS_MAX = 200;

export const itemsTagRequestSchema = z
  .strictObject({
    add: itemTagsSchema.default([]),
    paths: z
      .array(vaultPathSchema)
      .min(1)
      .max(ITEMS_TAG_PATHS_MAX)
      .refine((p) => new Set(p).size === p.length, "a path is named twice"),
    remove: itemTagsSchema.default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, "add or remove a tag")
  .refine(
    (v) => !v.add.some((t) => v.remove.some((r) => r.toLowerCase() === t.toLowerCase())),
    "a tag is both added and removed",
  );
export type ItemsTagRequest = z.infer<typeof itemsTagRequestSchema>;

export const itemTagResultSchema = z.strictObject({
  // removed tags still written as #tag in the text
  inline: z.array(z.string()),
  outcome: z.enum(["changed", "unchanged", "missing", "invalid", "conflict"]),
  path: z.string().min(1),
});
export type ItemTagResult = z.infer<typeof itemTagResultSchema>;

// in request order
export const itemsTagResponseSchema = z.strictObject({ results: z.array(itemTagResultSchema) });
export type ItemsTagResponse = z.infer<typeof itemsTagResponseSchema>;
