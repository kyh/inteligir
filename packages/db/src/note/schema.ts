// A note's SQLite, one per note's Durable Object: its live body as Yjs updates, what it owes the
// account's cell, and the built-in agent's turn log. drizzle-kit exports its DDL (ddl.sql), which
// the note applies as it wakes, as the cell does. No row
// passes a Durable Object's 2 MB: the compacted state is cut into parts of 1 MiB, an update is held
// to 1 MiB before it lands, and a turn log row is a part of its update.

import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// bytes as a Durable Object's SQLite binds and returns them, an ArrayBuffer, read as a Uint8Array
const bytes = customType<{ data: Uint8Array; driverData: ArrayBuffer }>({
  dataType: () => "blob",
  fromDriver: (value) => new Uint8Array(value),
  toDriver: (value) => new Uint8Array(value).buffer,
});

export const TURN_LOG_KINDS = ["pre", "turn"] as const;

// the note's one row: `version` counts the updates it persisted, and `projected` the last version
// its cell landed; a seed persisted before the cell confirmed it, a note past its cap, one in
// Deleted, one purged, and whether anyone but the agent wrote here since it was seeded
export const noteMeta = sqliteTable(
  "note_meta",
  {
    id: integer().primaryKey(),
    version: integer().notNull().default(0),
    projected: integer().notNull().default(0),
    // when the version passed what the cell holds, which the backstop counts from
    dirtyAt: integer("dirty_at"),
    // when a projection the cell did not take, or a seed's confirm it did not answer, is tried
    // again: the earlier of the two
    retryAt: integer("retry_at"),
    seedPending: integer("seed_pending").notNull().default(0),
    full: integer().notNull().default(0),
    deleted: integer().notNull().default(0),
    purged: integer().notNull().default(0),
    personEdited: integer("person_edited").notNull().default(0),
  },
  (t) => [check("note_meta_one", sql`${t.id} = 1`)],
);

// what the note took since its last compaction, in the order it took them
export const noteUpdates = sqliteTable("note_updates", {
  id: integer().primaryKey(),
  bytes: bytes().notNull(),
});

// the note's state as of its last compaction, one update cut into parts
export const snapshotParts = sqliteTable("snapshot_parts", {
  part: integer().primaryKey(),
  bytes: bytes().notNull(),
});

// each agent change set's edits here, a `pre` and a `turn` update an edit, each cut into parts
// (`@repo/service/note/turn-log`)
export const turnLog = sqliteTable(
  "turn_log",
  {
    changeSetId: text("change_set_id").notNull(),
    seq: integer().notNull(),
    part: integer().notNull(),
    kind: text({ enum: TURN_LOG_KINDS }).notNull(),
    bytes: bytes().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.changeSetId, t.seq, t.part] }),
    check("turn_log_kind", sql`${t.kind} IN ('pre', 'turn')`),
  ],
);

// where each change set's log stands after its last edit here, and when that was, which the prune
// counts the undo window from
export const turnCursors = sqliteTable(
  "turn_cursors",
  {
    changeSetId: text("change_set_id").primaryKey(),
    seq: integer().notNull(),
    stateVector: bytes("state_vector").notNull(),
    at: integer().notNull(),
  },
  (t) => [index("turn_cursors_at").on(t.at)],
);

// each agent edit's op id and what it answered, so an edit sent twice lands once
export const appliedOps = sqliteTable("applied_ops", {
  opId: text("op_id").primaryKey(),
  answer: text().notNull(),
});
