// An item's history in parts: its fields, its manifest and its highlights, each kept once per item
// under its content hash, so a revision that changed one block stores one manifest and shares the
// rest, and a block a write replaced keeps its content beside them by its own hash. Each part is
// capped well inside a Durable Object's 2 MB row, which is what bounds an item's blocks and
// highlights: a write past either cap is refused as too large.

import { annotationStoreSchema } from "@repo/notes/annotations/store-schema";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { contentHash } from "@repo/notes/library/block-hash";
import { blockHashSchema, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/notes/library/block-ops";
import { compareText, ordSchema } from "@repo/notes/library/block-order";
import { canonicalJson, utf8ByteLength } from "@repo/notes/library/canonical-json";
import { libraryItemFieldsSchema } from "@repo/notes/library/library-item";
import {
  blockIdSchema,
  libraryBlockSchema,
  librarySectionSchema,
} from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { chunkStatement, LibraryRowError } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import type { ItemNow, ItemSnapshot, ManifestEntry } from "@repo/notes/library/revert-change";
import { z } from "zod";

// a manifest of about 15,000 blocks, and as many highlights as fit beside them
const MANIFEST_MAX_BYTES = 1_000_000;
const HIGHLIGHTS_MAX_BYTES = 1_000_000;

// what a change set names an item's state by
export interface PartRefs {
  readonly fields: string;
  readonly manifest: string;
  readonly annotations: string;
}

interface EncodedPart {
  readonly hash: string;
  readonly json: string;
}

export interface EncodedParts {
  readonly fields: EncodedPart;
  readonly manifest: EncodedPart;
  readonly annotations: EncodedPart;
}

// one block's line: its id, hash, order key and section
const manifestSchema = z.array(
  z.tuple([blockIdSchema, blockHashSchema, ordSchema, librarySectionSchema]),
);

const encode = (json: string): EncodedPart => ({ hash: contentHash(json), json });

const manifestOf = (state: ItemState): ManifestEntry[] =>
  orderedBlocks(state.blocks).map((stored) => ({
    blockId: stored.block.id,
    hash: stored.hash,
    ord: stored.ord,
    section: stored.section,
  }));

// a highlight store in one spelling, so two equal stores share a part: ids in order, each entry's
// fields in the order the store's schema declares them
const storeJson = (store: AnnotationStore): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(store)
        .toSorted(([a], [b]) => compareText(a, b))
        .map(([id, entry]) => [
          id,
          {
            createdAt: entry.createdAt,
            parentId: entry.parentId,
            quote: entry.quote,
            source: entry.source,
            text: entry.text,
            updatedAt: entry.updatedAt,
          },
        ]),
    ),
  );

export const encodeParts = (now: ItemNow): EncodedParts => ({
  annotations: encode(storeJson(now.annotations)),
  fields: encode(canonicalJson(now.state.fields)),
  manifest: encode(
    JSON.stringify(
      manifestOf(now.state).map((entry) => [entry.blockId, entry.hash, entry.ord, entry.section]),
    ),
  ),
});

// whether an item in this state can keep its history: its manifest and its highlights each fit
// one row
export const partsFit = (parts: EncodedParts): boolean =>
  utf8ByteLength(parts.manifest.json) <= MANIFEST_MAX_BYTES &&
  utf8ByteLength(parts.annotations.json) <= HIGHLIGHTS_MAX_BYTES;

const INSERT_PART =
  "INSERT INTO snapshot_parts (item_id, hash, json) VALUES (?, ?, ?) ON CONFLICT DO NOTHING";

export const storeParts = (sql: SqlStatements, itemId: string, parts: EncodedParts): PartRefs => {
  for (const part of [parts.fields, parts.manifest, parts.annotations]) {
    sql.run(INSERT_PART, [itemId, part.hash, part.json]);
  }
  return {
    annotations: parts.annotations.hash,
    fields: parts.fields.hash,
    manifest: parts.manifest.hash,
  };
};

const partRowSchema = z.object({ json: z.string() });

const parseJson = <T>(json: string, schema: z.ZodType<T>, what: string): T => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new LibraryRowError(`${what} is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new LibraryRowError(`${what} is not what this build writes`, { cause: parsed.error });
  }
  return parsed.data;
};

const readPart = <T>(
  sql: SqlStatements,
  itemId: string,
  hash: string,
  schema: z.ZodType<T>,
  what: string,
): T => {
  const [row] = sql.all("SELECT json FROM snapshot_parts WHERE item_id = ? AND hash = ?", [
    itemId,
    hash,
  ]);
  const part = partRowSchema.safeParse(row);
  if (!part.success) {
    throw new LibraryRowError(`${what} ${hash} of ${itemId} is not kept`);
  }
  return parseJson(part.data.json, schema, `${what} ${hash}`);
};

export const readManifest = (sql: SqlStatements, itemId: string, hash: string): ManifestEntry[] =>
  readPart(sql, itemId, hash, manifestSchema, "a manifest").map(
    ([blockId, block, ord, section]) => ({
      blockId,
      hash: block,
      ord,
      section,
    }),
  );

export const readFieldsPart = (sql: SqlStatements, itemId: string, hash: string) =>
  readPart(sql, itemId, hash, libraryItemFieldsSchema, "an item's fields");

const readAnnotationsPart = (sql: SqlStatements, itemId: string, hash: string): AnnotationStore =>
  readPart(sql, itemId, hash, annotationStoreSchema, "an item's highlights");

export const readSnapshot = (sql: SqlStatements, itemId: string, refs: PartRefs): ItemSnapshot => ({
  annotations: readAnnotationsPart(sql, itemId, refs.annotations),
  fields: readFieldsPart(sql, itemId, refs.fields),
  manifest: readManifest(sql, itemId, refs.manifest),
});

// a block's content a write is about to replace or drop, kept for the revisions and undos that
// name it; the prune job sweeps what none does
export const keepSuperseded = (
  sql: SqlStatements,
  itemId: string,
  blocks: readonly StoredBlock[],
): void => {
  for (const statement of chunkStatement({
    each: "(?, ?, ?)",
    head: "INSERT INTO block_versions (item_id, hash, json) VALUES ",
    rows: blocks.map((stored) => [itemId, stored.hash, canonicalJson(stored.block)]),
    separator: ", ",
    tail: " ON CONFLICT DO NOTHING",
  })) {
    sql.run(statement.sql, statement.params);
  }
};

const versionRowSchema = z.object({ hash: z.string(), json: z.string() });

// the content of each of `hashes` this item ever held: from its blocks as they are, else from
// the versions a write kept
export const blockContents = (
  sql: SqlStatements,
  itemId: string,
  hashes: ReadonlySet<string>,
): Map<string, LibraryBlock> => {
  const found = new Map<string, LibraryBlock>();
  const wanted = [...hashes];
  for (const table of ["blocks", "block_versions"] as const) {
    const missing = wanted.filter((hash) => !found.has(hash));
    for (const statement of chunkStatement({
      each: "?",
      head: `SELECT hash, json FROM ${table} WHERE item_id = ? AND hash IN (`,
      headParams: [itemId],
      rows: missing.map((hash) => [hash]),
      separator: ", ",
      tail: ")",
    })) {
      for (const raw of sql.all(statement.sql, statement.params)) {
        const row = versionRowSchema.parse(raw);
        found.set(row.hash, parseJson(row.json, libraryBlockSchema, "a block version"));
      }
    }
  }
  return found;
};
