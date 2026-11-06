// The phone keeps ONE database file. The library's replica is the engine's: it opens the shared
// schema and versions it by `meta.schema` (`@repo/notes/library/library-schema`), starting over on
// any other version. Beside it sit the phone's own tables, which this module opens once the engine
// has, versioned the same way under a key of its own (`meta.phone_schema`), never `user_version`.
// No phone holds a file worth keeping until the first build EAS makes (`easProject` in
// app.config.js), so until then the phone's schema is one step, edited in place; from that build
// on, a step is appended, never edited.

import type { ReplicaSql } from "@repo/library-replica/replica-ports";
import { z } from "zod";

// phone_files: what the phone keeps of the library's files, by name (a file's SHA-256, or a
// cover's thumbnail beside it), the place it is kept in, the type it was kept or served as and its
// size, and when a screen last drew it, by which the discardable ones go least recently used
// first. phone_staged: the type each file waiting to be sent was kept as, which its bytes in the
// staged folder do not carry.
const PHONE_STEPS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE phone_files (
       name TEXT PRIMARY KEY,
       place TEXT NOT NULL CHECK (place IN ('pinned', 'cache')),
       mime TEXT NOT NULL,
       bytes INTEGER NOT NULL CHECK (bytes >= 0),
       used_at INTEGER NOT NULL
     ) STRICT, WITHOUT ROWID`,
    "CREATE INDEX phone_files_lru ON phone_files (place, used_at)",
    `CREATE TABLE phone_staged (
       sha TEXT PRIMARY KEY,
       mime TEXT NOT NULL
     ) STRICT, WITHOUT ROWID`,
  ],
];

const storedSchema = z.array(z.object({ v: z.number().int().min(0) }));

// the phone's tables brought to this build's step; a file a newer build wrote is refused rather
// than read in a shape this build does not know
export const openPhoneTables = async (sql: ReplicaSql): Promise<void> => {
  await sql.exclusive(async (tx) => {
    const [row] = storedSchema.parse(
      await tx.all("SELECT v FROM meta WHERE k = 'phone_schema'", []),
    );
    const version = row?.v ?? 0;
    if (version > PHONE_STEPS.length) {
      throw new Error("This phone's library was saved by a newer version of the app.");
    }
    for (const step of PHONE_STEPS.slice(version)) {
      for (const statement of step) {
        await tx.run(statement, []);
      }
    }
    if (version < PHONE_STEPS.length) {
      await tx.run(
        "INSERT INTO meta (k, v) VALUES ('phone_schema', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
        [PHONE_STEPS.length],
      );
    }
  });
};
