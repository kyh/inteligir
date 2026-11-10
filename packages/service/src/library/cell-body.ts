// What the cell keeps of an item's body. Until its note first opens, the body is the cell's own:
// its blocks in reading order as seed rows, which the note's first load reads and its confirm drops.
// Either way the cell holds the body's text, cut into parts at line ends, which search's literal tier
// matches and the index's body column is read from.

import { and, asc, eq, sql } from "drizzle-orm";

import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { libraryBlockSchema } from "@repo/contract/library/library-nodes";
import { bodyTexts, items, seedBlocks } from "@repo/db/cell/schema";

import { insertChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { LibraryRowError } from "./library-sql";

// a part sits well inside a Durable Object's 2 MB row
const TEXT_PART_BYTES = 512 * 1024;

// the text cut at line ends into parts within TEXT_PART_BYTES; a line longer than a part is cut
// between characters, so only such a line can split a match
const textParts = (text: string): string[] => {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  const push = (piece: string, size: number): void => {
    if (bytes + size > TEXT_PART_BYTES && part !== "") {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += piece;
    bytes += size;
  };
  for (const line of text.split(/(?<=\n)/u)) {
    const size = utf8ByteLength(line);
    if (size <= TEXT_PART_BYTES) {
      push(line, size);
      continue;
    }
    for (const char of line) {
      push(char, utf8ByteLength(char));
    }
  }
  return part === "" ? parts : [...parts, part];
};

export const storeBodyText = (db: CellDb, itemId: string, text: string): void => {
  db.delete(bodyTexts).where(eq(bodyTexts.itemId, itemId)).run();
  const rows = textParts(text).map((part, index) => ({ itemId, part: index, text: part }));
  for (const chunk of insertChunks(bodyTexts, rows)) {
    db.insert(bodyTexts).values(chunk).run();
  }
};

export const readBodyText = (db: CellDb, itemId: string): string =>
  db
    .select({ text: bodyTexts.text })
    .from(bodyTexts)
    .where(eq(bodyTexts.itemId, itemId))
    .orderBy(asc(bodyTexts.part))
    .all()
    .map((row) => row.text)
    .join("");

// the body the cell keeps for an item whose note has yet to open, over whatever it kept before
export const storeSeed = (db: CellDb, itemId: string, blocks: readonly BodyBlock[]): void => {
  db.delete(seedBlocks).where(eq(seedBlocks.itemId, itemId)).run();
  const rows = blocks.map(({ block, section }, pos) => ({
    blockId: block.id,
    itemId,
    json: canonicalJson(block),
    pos,
    section,
  }));
  for (const chunk of insertChunks(seedBlocks, rows)) {
    db.insert(seedBlocks).values(chunk).run();
  }
};

const parseBlock = (json: string, itemId: string) => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new LibraryRowError(`a seed block of ${itemId} is not JSON`, { cause: error });
  }
  const parsed = libraryBlockSchema.safeParse(value);
  if (!parsed.success) {
    throw new LibraryRowError(`a seed block of ${itemId} is not what this build writes`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

export const readSeedBlocks = (db: CellDb, itemId: string): BodyBlock[] =>
  db
    .select({ json: seedBlocks.json, section: seedBlocks.section })
    .from(seedBlocks)
    .where(eq(seedBlocks.itemId, itemId))
    .orderBy(asc(seedBlocks.pos))
    .all()
    .map((row) => ({ block: parseBlock(row.json, itemId), section: row.section }));

// where an item's body is to be read: the seed the cell keeps, or the item's note; null for no item
// that is not purged
export type HeldBody =
  | { readonly kind: "seed"; readonly blocks: BodyBlock[] }
  | { readonly kind: "note" }
  | null;

export const heldBody = (db: CellDb, itemId: string): HeldBody => {
  const row = db
    .select({ home: items.bodyHome })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.purged, 0)))
    .get();
  if (row === undefined) {
    return null;
  }
  return row.home === "note"
    ? { kind: "note" }
    : { blocks: readSeedBlocks(db, itemId), kind: "seed" };
};

export const dropSeed = (db: CellDb, itemId: string): void => {
  db.delete(seedBlocks).where(eq(seedBlocks.itemId, itemId)).run();
};

// the bytes every live note's object holds, as each last projected
export const noteBytes = (db: CellDb): number =>
  db
    .select({ bytes: sql`coalesce(sum(${items.bodyBytes}), 0)`.mapWith(Number) })
    .from(items)
    .where(and(eq(items.bodyHome, "note"), eq(items.purged, 0)))
    .get()?.bytes ?? 0;
