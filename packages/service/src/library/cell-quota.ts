// What an account's library may hold: 1 GiB of its files' bytes and its SQLite together, change
// sets included (owner decision: what Undo keeps counts toward it). The files' bytes, uploads
// still held open among them, are `meta.bytes_used`; the SQLite is what the Durable Object reports.
// A write that adds words past the cap, in a block or a field, is refused, and one
// that frees or keeps them never is, so a full library can still be tidied.

import { z } from "zod";

import { readMeta, writeMeta } from "./library-queries";

import type { CellDb } from "./cell-db";
import type { CellStorage } from "./cell-storage";
import { refuse } from "./cell-refusal";

const BYTES_USED = "bytes_used";

const countSchema = z.number().int().nonnegative();

// the files' bytes the library holds or holds room for
const fileBytes = (db: CellDb): number => {
  const held = readMeta(db, BYTES_USED);
  return held === null ? 0 : countSchema.parse(held);
};

export const addFileBytes = (db: CellDb, delta: number): void => {
  writeMeta(db, BYTES_USED, Math.max(0, fileBytes(db) + delta));
};

const bytesUsed = (storage: CellStorage): number => fileBytes(storage.db) + storage.databaseSize();

// refuses `growth` more bytes once they would pass the cap
export const holdRoomFor = (storage: CellStorage, bytesCap: number, growth: number): void => {
  if (growth <= 0) {
    return;
  }
  const used = bytesUsed(storage);
  if (used + growth > bytesCap) {
    refuse({ bytesCap, bytesUsed: used, kind: "quota" });
  }
};
