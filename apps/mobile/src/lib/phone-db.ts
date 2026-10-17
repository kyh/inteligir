// the phone keeps ONE database file, so every table in it rides one `user_version`, and each step
// opens in the transaction that records it. No phone holds a file worth keeping until the first
// build EAS makes (`easProject` in app.config.js), so until then the schema is one step, edited in
// place; from that build on, a step is appended, never edited.

import { z } from "zod";
import type { SqlDriver, SqlExecutor } from "./sql-driver";

// mirror_meta's tree_commit is the tree the rows hold, mirrored_commit the last one they held
// every wanted text of. mirror_entries puts content last: a listing read stops at the columns
// before it rather than walking a long note's overflow pages to reach one after it. `item` is a
// doc's library card as JSON, read from its text when the text lands, so the library lists
// without parsing a note.
// outbox: the phone's unsent writes, oldest first; `op` and `settle` are JSON parsed on every
// read. mirror_landings: which paths a landed write moved, in landing order, so a refresh that
// listed the tree before a landing leaves those rows alone.
// dispatch_outbox: the phone's requests to a Mac, oldest first. `request` is the body sent, frozen
// when it is asked so every resend is the same row; `status` the cloud's last answer as JSON,
// null until the cloud has taken the row. `sent` is not a column of its own: it would be a
// second answer to the question `status` already answers, and a turn's thread is its request's.
// the synced threads: thread_sync the pull cursor and the grammar the held events were parsed
// with, thread_events each held event by its log seq, synced_threads each thread's last seq,
// which a delta moves though no row holds it.
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
     item TEXT,
     content TEXT,
     CHECK (content IS NOT NULL OR (note_id IS NULL AND aliases = '[]' AND item IS NULL))
   );
   CREATE TABLE outbox (
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
   );
   CREATE TABLE dispatch_outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     request TEXT NOT NULL,
     status TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE thread_sync (
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
];

const userVersionSchema = z.object({ user_version: z.number().int().min(0) });

const migratePhoneDb = async (db: SqlDriver): Promise<void> => {
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

// true while the sign-in the work started under is still the one it may write for
export type Fence = () => boolean;

// every call through the returned driver waits out one migration, run on the first call so a
// failed migration fails the call that asked rather than nobody, and forgotten when it fails so
// the next call tries again. Every module over the one file shares it.
export const openPhoneDb = (driver: SqlDriver): SqlDriver => {
  let migrated: Promise<void> | null = null;
  const ready = async (): Promise<void> => {
    migrated ??= migratePhoneDb(driver);
    const current = migrated;
    try {
      await current;
    } catch (error) {
      if (migrated === current) {
        migrated = null;
      }
      throw error;
    }
  };
  return {
    all: async (sql, params) => {
      await ready();
      return await driver.all(sql, params);
    },
    exclusive: async (work) => {
      await ready();
      return await driver.exclusive(work);
    },
  };
};

export type Fenced<T> = { ran: true; value: T } | { ran: false };

// the fence is checked again inside the transaction: a wipe queued ahead of it must win. `ran` when
// `work` ran and committed
export const fencedExclusive = async <T>(
  db: SqlDriver,
  fence: Fence,
  work: (tx: SqlExecutor) => Promise<T>,
): Promise<Fenced<T>> =>
  await db.exclusive(async (tx) =>
    fence() ? { ran: true, value: await work(tx) } : { ran: false },
  );
