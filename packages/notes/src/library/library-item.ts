// An item's fields: everything an item is besides its body, one column each in the library's
// `items` table. Its id, url key, card and sequence number are the row's, never a writer's;
// `@repo/notes/library/derive-item` computes what is derived and the cell stamps the rest.

import { z } from "zod";

import { isTagName } from "../knowledge/tag-grammar";
import { ITEM_KINDS } from "../items/item-kind";
import { isWebUrl } from "../items/item-url";
import { canonicalJson, utf8ByteLength } from "./canonical-json";

// where a url item's page reading stands: never asked (a note, a file), asked and waiting, read,
// or tried and failed; a stub is a url item still `pending`
export const FETCH_STATES = ["none", "pending", "filled", "failed"] as const;
export const fetchStateSchema = z.enum(FETCH_STATES);

// a file's bytes are named by their SHA-256, as R2 keeps them
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;
const sha256 = z.string().regex(SHA256_HEX_RE);

// unix milliseconds
const instant = z.number().int().nonnegative();

// An item's row must fit a Durable Object's 2 MB, so every field is capped well inside it: the
// short ones at a line's length, the description at a paragraph's, the properties at a quarter
// megabyte of JSON.
const LINE_MAX = 1000;
const URL_MAX = 8192;
const DESCRIPTION_MAX = 10_000;
const LIST_MAX = 500;
const PROPERTIES_MAX_BYTES = 256 * 1024;

const text = z.string().min(1).max(LINE_MAX);

export const tagNameSchema = z
  .string()
  .max(LINE_MAX)
  .refine(isTagName, { error: "is not a tag name" });

const properties = z
  .record(text, z.json())
  .refine((value) => utf8ByteLength(canonicalJson(value)) <= PROPERTIES_MAX_BYTES, {
    error: `holds more than ${String(PROPERTIES_MAX_BYTES)} bytes of properties`,
  });

export const libraryItemFieldsSchema = z.strictObject({
  aliases: z.array(text).max(LIST_MAX),
  author: text.nullable(),
  copySha: sha256.nullable(),
  coverSha: sha256.nullable(),
  deletedAt: instant.nullable(),
  description: z.string().min(1).max(DESCRIPTION_MAX).nullable(),
  fetchError: text.nullable(),
  fetchState: fetchStateSchema,
  fetchedAt: instant.nullable(),
  folderId: text.nullable(),
  kind: z.enum(ITEM_KINDS),
  lang: text.nullable(),
  originalSha: sha256.nullable(),
  pinnedAt: instant.nullable(),
  // what a frontmatter key held that no column names, as any JSON, so an import loses none
  properties,
  published: text.nullable(),
  savedAt: instant,
  site: text.nullable(),
  tags: z.array(tagNameSchema).max(LIST_MAX),
  title: z.string().max(LINE_MAX),
  url: z.string().max(URL_MAX).refine(isWebUrl, { error: "is not a web address" }).nullable(),
});
export type LibraryItemFields = z.infer<typeof libraryItemFieldsSchema>;
export type PropertyValue = LibraryItemFields["properties"][string];

// the fields a fill writes, and Refresh replaces; every other field is the person's (or an
// agent's, on the person's behalf)
export const FILL_OWNED_FIELDS = [
  "author",
  "copySha",
  "coverSha",
  "description",
  "fetchError",
  "fetchState",
  "fetchedAt",
  "kind",
  "lang",
  "published",
  "site",
] as const satisfies readonly (keyof LibraryItemFields)[];
