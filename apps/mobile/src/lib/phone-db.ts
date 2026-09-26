// the phone keeps ONE database file, so every table in it rides one `user_version`: a step is
// appended here, never edited once shipped, and each opens in the transaction that records it.

import { z } from "zod";
import type { SqlDriver } from "./sql-driver";

// mirror_meta's tree_commit is the tree the rows hold, mirrored_commit the last one they held
// every wanted text of. mirror_entries puts content last: a listing read stops at the columns
// before it rather than walking a long note's overflow pages to reach one after it.
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE mirror_meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     tree_commit TEXT NOT NULL,
     mirrored_commit TEXT
   );
   CREATE TABLE mirror_entries (
     path TEXT PRIMARY KEY NOT NULL,
     oid TEXT NOT NULL,
     size INTEGER NOT NULL,
     pin_commit TEXT NOT NULL,
     wants_text INTEGER NOT NULL CHECK (wants_text IN (0, 1)),
     note_id TEXT,
     aliases TEXT NOT NULL DEFAULT '[]',
     content TEXT,
     CHECK (content IS NOT NULL OR (note_id IS NULL AND aliases = '[]'))
   );`,
];

const userVersionSchema = z.object({ user_version: z.number().int().min(0) });

export const migratePhoneDb = async (db: SqlDriver): Promise<void> => {
  await db.exclusive(async (tx) => {
    const [row] = await tx.all("PRAGMA user_version");
    const version = userVersionSchema.parse(row).user_version;
    if (version > MIGRATIONS.length) {
      throw new Error("This phone's notes were saved by a newer version of the app.");
    }
    for (const step of MIGRATIONS.slice(version)) {
      await tx.exec(step);
    }
    if (version < MIGRATIONS.length) {
      await tx.exec(`PRAGMA user_version = ${String(MIGRATIONS.length)}`);
    }
  });
};
