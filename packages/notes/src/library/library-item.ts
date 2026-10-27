// An item's fields: everything an item is besides its body, one column each in the library's
// `items` table. Its id, url key, card and sequence number are the row's, never a writer's;
// `@repo/notes/library/derive-item` computes what is derived and the cell stamps the rest.

import { z } from "zod";

import { isTagName } from "../knowledge/tag-grammar";
import { ITEM_KINDS } from "../items/item-kind";
import { isWebUrl } from "../items/item-url";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import type { JsonValue } from "./canonical-json";

// where a url item's page reading stands: never asked (a note, a file), asked and waiting, read,
// or tried and failed; a stub is a url item still `pending`
export const FETCH_STATES = ["none", "pending", "filled", "failed"] as const;
const fetchStateSchema = z.enum(FETCH_STATES);

// a file's bytes are named by their SHA-256, as R2 keeps them
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;
const sha256 = z.string().regex(SHA256_HEX_RE);

// unix milliseconds
const instant = z.number().int().nonnegative();

// An item's row, its card and url key included, must fit a SQLite Durable Object's 2 MB
// (https://developers.cloudflare.com/durable-objects/platform/limits/), so every field is capped:
// the short ones at a line's length (in UTF-16 units, as zod counts), the description at a
// paragraph's, and each list and the properties by the bytes of their JSON, since a list of
// short entries can still be long. The largest legal row is about 0.7 MB, summed by a test.
export const ITEM_FIELD_CAPS = {
  description: 10_000,
  line: 1000,
  listBytes: 64 * 1024,
  listEntries: 500,
  propertiesBytes: 256 * 1024,
  url: 8192,
} as const;

const jsonBytes = (value: JsonValue): number => utf8ByteLength(canonicalJson(value));

const text = z.string().min(1).max(ITEM_FIELD_CAPS.line);

// a property's key: a line, as a frontmatter key is
export const propertyKeySchema = text;

const listOf = (entry: z.ZodString) =>
  z
    .array(entry)
    .max(ITEM_FIELD_CAPS.listEntries)
    .refine((list) => jsonBytes(list) <= ITEM_FIELD_CAPS.listBytes, {
      error: `holds more than ${String(ITEM_FIELD_CAPS.listBytes)} bytes`,
    });

const tagNameSchema = z
  .string()
  .max(ITEM_FIELD_CAPS.line)
  .refine(isTagName, { error: "is not a tag name" });

const properties = z
  .record(propertyKeySchema, z.json())
  .refine((value) => jsonBytes(value) <= ITEM_FIELD_CAPS.propertiesBytes, {
    error: `holds more than ${String(ITEM_FIELD_CAPS.propertiesBytes)} bytes of properties`,
  });

export const libraryItemFieldsSchema = z.strictObject({
  aliases: listOf(text),
  author: text.nullable(),
  copySha: sha256.nullable(),
  coverSha: sha256.nullable(),
  deletedAt: instant.nullable(),
  description: z.string().min(1).max(ITEM_FIELD_CAPS.description).nullable(),
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
  tags: listOf(tagNameSchema),
  title: z.string().max(ITEM_FIELD_CAPS.line),
  url: z
    .string()
    .max(ITEM_FIELD_CAPS.url)
    .refine(isWebUrl, { error: "is not a web address" })
    .nullable(),
});
export type LibraryItemFields = z.infer<typeof libraryItemFieldsSchema>;
export type LibraryItemField = keyof LibraryItemFields;
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
