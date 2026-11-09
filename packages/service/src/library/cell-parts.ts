// What a change set keeps of an item, in parts: its fields and its manifest, each kept once per
// item under its content hash, so a set that changed one block stores one manifest and shares the
// fields, and a block a write replaced keeps its content beside them by its own hash. A manifest
// is capped well inside a Durable Object's 2 MB row, which is what bounds an item's blocks: a
// write past the cap is refused as too large.

import { contentHash } from "@repo/contract/library/block-hash";
import { blockHashSchema, orderedBlocks } from "@repo/contract/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/contract/library/block-ops";
import { ordSchema } from "@repo/contract/library/block-order";
import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import {
  blockIdSchema,
  collectFileShas,
  libraryBlockSchema,
  librarySectionSchema,
} from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { chunkStatement, LibraryRowError } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import type { ItemNow, ItemSnapshot, ManifestEntry } from "./revert-change";
import { z } from "zod";

import { fieldFilesOf, keepSetFiles } from "./cell-blobs";

// a manifest of about 15,000 blocks
const MANIFEST_MAX_BYTES = 1_000_000;

// what a change set names an item's state by
export interface PartRefs {
  readonly fields: string;
  readonly manifest: string;
}

interface EncodedPart {
  readonly hash: string;
  readonly json: string;
}

export interface EncodedParts {
  readonly fields: EncodedPart;
  readonly manifest: EncodedPart;
  // the files the fields name
  readonly files: readonly string[];
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

export const encodeParts = (now: ItemNow): EncodedParts => ({
  fields: encode(canonicalJson(now.state.fields)),
  files: fieldFilesOf(now.state.fields),
  manifest: encode(
    JSON.stringify(
      manifestOf(now.state).map((entry) => [entry.blockId, entry.hash, entry.ord, entry.section]),
    ),
  ),
});

// whether a change set can keep an item in this state: its manifest fits one row
export const partsFit = (parts: EncodedParts): boolean =>
  utf8ByteLength(parts.manifest.json) <= MANIFEST_MAX_BYTES;

const INSERT_PART =
  "INSERT INTO snapshot_parts (item_id, hash, json) VALUES (?, ?, ?) ON CONFLICT DO NOTHING";

export const storeParts = (sql: SqlStatements, itemId: string, parts: EncodedParts): PartRefs => {
  for (const part of [parts.fields, parts.manifest]) {
    sql.run(INSERT_PART, [itemId, part.hash, part.json]);
  }
  keepSetFiles(sql, itemId, parts.fields.hash, parts.files);
  return {
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

export const readSnapshot = (sql: SqlStatements, itemId: string, refs: PartRefs): ItemSnapshot => ({
  fields: readFieldsPart(sql, itemId, refs.fields),
  manifest: readManifest(sql, itemId, refs.manifest),
});

// a block's content a write is about to replace or drop, kept for the change sets that name it; the
// prune job sweeps what none does
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
  for (const stored of blocks) {
    const files = new Set<string>();
    collectFileShas(stored.block, files);
    keepSetFiles(sql, itemId, stored.hash, [...files]);
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
