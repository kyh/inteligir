import { z } from "zod";

import { isTagName } from "../knowledge/tag-grammar";
import { ITEM_KINDS } from "../items/item-kind";
import { isWebUrl } from "../items/item-url";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import type { JsonValue } from "./canonical-json";

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/u;
const sha256 = z.string().regex(SHA256_HEX_RE);

const instant = z.number().int().nonnegative();

export const ITEM_FIELD_CAPS = {
  description: 10_000,
  line: 1000,
  listBytes: 64 * 1024,
  listEntries: 500,
  propertiesBytes: 256 * 1024,
  url: 8192,
} as const;

const jsonBytes = (value: JsonValue) => utf8ByteLength(canonicalJson(value));

const text = z.string().min(1).max(ITEM_FIELD_CAPS.line);

export const propertyKeySchema = text.refine((key) => key !== "__proto__", {
  error: "is no property's key",
});

const listOf = (entry: z.ZodString) =>
  z
    .array(entry)
    .max(ITEM_FIELD_CAPS.listEntries)
    .refine((list) => jsonBytes(list) <= ITEM_FIELD_CAPS.listBytes, {
      error: `holds more than ${String(ITEM_FIELD_CAPS.listBytes)} bytes`,
    });

const fileNameSchema = text.refine(
  (name) => !/[/\\\0]/u.test(name) && name !== "." && name !== "..",
  { error: "is not a file name" },
);

const tagNameSchema = z
  .string()
  .max(ITEM_FIELD_CAPS.line)
  .refine(isTagName, { error: "is not a tag name" });

const properties = z
  .record(propertyKeySchema, z.json())
  .refine((value) => jsonBytes(value) <= ITEM_FIELD_CAPS.propertiesBytes, {
    error: `holds more than ${String(ITEM_FIELD_CAPS.propertiesBytes)} bytes of properties`,
  });

const readingErrorSchema = text;

const reading = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ at: instant.nullable(), state: z.literal("pending") }),
  z.object({ at: instant, state: z.literal("read") }),
  z.object({ at: instant.nullable(), error: readingErrorSchema, state: z.literal("failed") }),
]);

export const libraryItemFieldsSchema = z.strictObject({
  aliases: listOf(text),
  author: text.nullable(),
  coverSha: sha256.nullable(),
  deletedAt: instant.nullable(),
  description: z.string().min(1).max(ITEM_FIELD_CAPS.description).nullable(),
  folderId: z.uuid().nullable(),
  kind: z.enum(ITEM_KINDS),
  lang: text.nullable(),
  originalName: fileNameSchema.nullable(),
  originalSha: sha256.nullable(),
  pinnedAt: instant.nullable(),
  properties,
  published: text.nullable(),
  reading,
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

export const importedFieldsSchema = libraryItemFieldsSchema.omit({
  deletedAt: true,
  folderId: true,
});

export type ImportedFields = z.infer<typeof importedFieldsSchema>;

export type PropertyValue = LibraryItemFields["properties"][string];
