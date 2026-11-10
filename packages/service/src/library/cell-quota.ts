// What an account's library may hold: 1 GiB of its files' bytes, its SQLite and its notes' together,
// change sets included (owner decision: what Undo keeps counts toward it). The files' bytes, uploads
// still held open among them, are `meta.bytes_used`; the SQLite is what the Durable Object reports,
// and a note's bytes what its object last projected. Only a create past the cap is refused, so a
// person never loses a word mid-note and a full library can still be tidied.

import { readCount, writeMeta } from "./library-queries";

import { noteBytes } from "./cell-body";
import type { CellDb } from "./cell-db";
import type { CellStorage } from "./cell-storage";
import { refuse } from "./cell-refusal";

const BYTES_USED = "bytes_used";

// the files' bytes the library holds or holds room for
const fileBytes = (db: CellDb): number => readCount(db, BYTES_USED);

export const addFileBytes = (db: CellDb, delta: number): void => {
  writeMeta(db, BYTES_USED, Math.max(0, fileBytes(db) + delta));
};

const bytesUsed = (storage: CellStorage): number =>
  fileBytes(storage.db) + storage.databaseSize() + noteBytes(storage.db);

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
