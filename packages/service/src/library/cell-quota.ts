// What an account's library may hold: 1 GiB of its files' bytes, its SQLite and its notes' together,
// change sets included (owner decision: what Undo keeps counts toward it). The files' bytes are
// what their rows say, an upload's room still held open among them; the SQLite is what the Durable
// Object reports, and a note's bytes what its object last projected. Only a create past the cap is
// refused, so a person never loses a word mid-note and a full library can still be tidied.

import { sql } from "drizzle-orm";

import { blobs, blobUploads } from "@repo/db/cell/schema";
import { noteBytes } from "./cell-body";
import type { CellDb } from "./cell-db";
import { refuse } from "./cell-refusal";

const bytesIn = (db: CellDb, table: typeof blobs | typeof blobUploads): number =>
  db
    .select({ bytes: sql`coalesce(sum(${table.bytes}), 0)`.mapWith(Number) })
    .from(table)
    .get()?.bytes ?? 0;

// the SQLite's size is what the cell's storage holds, its change sets included
const bytesUsed = (db: CellDb): number =>
  bytesIn(db, blobs) + bytesIn(db, blobUploads) + db.$client.sql.databaseSize + noteBytes(db);

// refuses `growth` more bytes once they would pass the cap
export const holdRoomFor = (db: CellDb, bytesCap: number, growth: number): void => {
  if (growth <= 0) {
    return;
  }
  const used = bytesUsed(db);
  if (used + growth > bytesCap) {
    refuse({ bytesCap, bytesUsed: used, kind: "quota" });
  }
};
