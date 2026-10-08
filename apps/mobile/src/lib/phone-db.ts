// the phone keeps ONE database file, so every table in it rides one `user_version`: a step is
// appended here, never edited once shipped, and each opens in the transaction that records it.

import { z } from "zod";
import type { SqlDriver, SqlExecutor } from "./sql-driver";

// the first two steps made the notes mirror and its outbox, which the fifth drops: their words stay
// as they shipped, since a step is never edited once it has run on a phone.
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
  // outbox: the phone's unsent writes, oldest first; `op` and `settle` are JSON parsed on every
  // read. mirror_landings: which paths a landed write moved, in landing order, so a refresh that
  // listed the tree before a landing leaves those rows alone.
  `CREATE TABLE outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     op TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'parked')),
     reason TEXT,
     settle TEXT,
     created_at INTEGER NOT NULL,
     CHECK ((state = 'parked') = (reason IS NOT NULL))
   );
   CREATE TABLE mirror_landings (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     path TEXT NOT NULL
   );`,
  // dispatch_outbox: the phone's requests to a Mac, oldest first. `request` is the body sent, frozen
  // when it is asked so every resend is the same row; `status` the cloud's last answer as JSON,
  // null until the cloud has taken the row. `sent` is not a column of its own: it would be a
  // second answer to the question `status` already answers.
  `CREATE TABLE dispatch_outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     thread_id TEXT NOT NULL,
     request TEXT NOT NULL,
     status TEXT,
     created_at INTEGER NOT NULL
   );`,
  // the synced threads: thread_sync the pull cursor and the grammar the held events were parsed
  // with, thread_events each held event by its log seq, synced_threads each thread's last seq,
  // which a delta moves though no row holds it
  `CREATE TABLE thread_sync (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     cursor INTEGER NOT NULL,
     grammar TEXT NOT NULL
   );
   CREATE TABLE thread_events (
     seq INTEGER PRIMARY KEY,
     thread_id TEXT NOT NULL,
     event TEXT NOT NULL
   );
   CREATE TABLE synced_threads (
     thread_id TEXT PRIMARY KEY NOT NULL,
     last_seq INTEGER NOT NULL
   );`,
  // the notes mirror and the outbox of the phone's own edits are gone with the phone's notes
  `DROP TABLE IF EXISTS mirror_landings;
   DROP TABLE IF EXISTS outbox;
   DROP TABLE IF EXISTS mirror_entries;
   DROP TABLE IF EXISTS mirror_meta;`,
];

const userVersionSchema = z.object({ user_version: z.number().int().min(0) });

const migratePhoneDb = async (db: SqlDriver): Promise<void> => {
  await db.exclusive(async (tx) => {
    const [row] = await tx.all("PRAGMA user_version");
    const version = userVersionSchema.parse(row).user_version;
    if (version > MIGRATIONS.length) {
      throw new Error("This phone's data was saved by a newer version of the app.");
    }
    for (const step of MIGRATIONS.slice(version)) {
      await tx.exec(step);
    }
    if (version < MIGRATIONS.length) {
      await tx.exec(`PRAGMA user_version = ${String(MIGRATIONS.length)}`);
    }
  });
};

// true while the sign-in the work started under is still the one it may write for
export type Fence = () => boolean;

// every module over the one file shares its migration
const migrations = new WeakMap<SqlDriver, Promise<void>>();

// run on the first call, so a failed migration fails the call that asked rather than nobody, and
// forgotten when it fails, so the next call tries again
export const phoneDbReady = async (db: SqlDriver): Promise<void> => {
  let migrated = migrations.get(db);
  if (migrated === undefined) {
    migrated = migratePhoneDb(db);
    migrations.set(db, migrated);
  }
  try {
    await migrated;
  } catch (error) {
    if (migrations.get(db) === migrated) {
      migrations.delete(db);
    }
    throw error;
  }
};

// the fence is checked again inside the transaction: a wipe queued ahead of it must win. true when
// `work` ran and committed
export const fencedExclusive = async (
  db: SqlDriver,
  fence: Fence,
  work: (tx: SqlExecutor) => Promise<void>,
): Promise<boolean> => {
  await phoneDbReady(db);
  const outcome = { ran: false };
  await db.exclusive(async (tx) => {
    if (!fence()) {
      return;
    }
    await work(tx);
    outcome.ran = true;
  });
  return outcome.ran;
};
