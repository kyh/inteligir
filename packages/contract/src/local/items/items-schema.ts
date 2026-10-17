// the item schemas every library surface shares; each row mirrors an engine type in
// @repo/notes/items, held equal by the engine-mirror test.

import { ITEM_KINDS } from "@repo/notes/items/item-kind";
import { parseItemTime } from "@repo/notes/items/item-time";
import { z } from "zod";
import { vaultPathSchema } from "../vault/vault-schema";

export const itemKindSchema = z.enum(ITEM_KINDS);
export const itemSortSchema = z.enum(["saved", "modified", "title", "relevance"]);
// "" is the library root
export const libraryFolderSchema = z.union([z.literal(""), vaultPathSchema]);
export const itemTimeSchema = z.string().refine((v) => parseItemTime(v) !== null, {
  message: "an ISO date or time, e.g. 2026-10-16 or 2026-10-16T09:00:00Z",
});

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
