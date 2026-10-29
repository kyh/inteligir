// What an account's library may hold: 1 GiB of its files' bytes and its SQLite together, history
// included (owner decision: revisions count toward it, as the hosted vault's history did). The
// files' bytes, uploads still held open among them, are `meta.bytes_used`; the SQLite is what the
// Durable Object reports. A write that adds bytes past the cap is refused, and one that frees or
// keeps them never is, so a full library can still be tidied.

import { readMeta, writeMeta } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { CellStorage } from "./cell-storage";
import { refuse } from "./cell-refusal";

const BYTES_USED = "bytes_used";

const countSchema = z.number().int().nonnegative();

// the files' bytes the library holds or holds room for
const fileBytes = (storage: CellStorage): number => {
  const held = runPlan(storage, readMeta(BYTES_USED));
  return held === null ? 0 : countSchema.parse(held);
};

export const addFileBytes = (storage: CellStorage, delta: number): void => {
  runPlan(storage, writeMeta(BYTES_USED, Math.max(0, fileBytes(storage) + delta)));
};

const bytesUsed = (storage: CellStorage): number => fileBytes(storage) + storage.databaseSize();

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
