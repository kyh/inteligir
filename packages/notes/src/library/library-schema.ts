// The one schema of the library's SQLite, which the account's cell creates. Its version is the
// `schema` row of `meta`, never SQLite's own version pragma, which a Durable Object refuses
// (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
// There is no migration: a cell that finds another version answers `mismatch`, and its host
// starts it over.

import { z } from "zod";

import { ITEM_KINDS } from "../items/item-kind";
import { FETCH_STATES } from "./library-item";
import { LIBRARY_SECTIONS } from "./library-nodes";
import { all, run } from "./library-sql";
import type { SqlPlan, SqlRow } from "./library-sql";

// bump on any change below, since no build reads a schema of another version
/** @internal */
export const LIBRARY_SCHEMA_VERSION = 13;

const TAG_ORIGINS = ["field", "inline"] as const;
// who a change set is by: the person, the built-in agent, a connected assistant, an import, the
// cloud reading a page, or an undo
export const CHANGE_SET_ACTORS = [
  "person",
  "agent",
  "assistant",
  "import",
  "fill",
  "undo",
] as const;

// what an import reads (a Raindrop export, a folder of markdown zipped, Obsidian's included), where
// a job stands, and the phase a running one is in: reading the file into its plan, landing its
// items a page at a time, then the files no item embedded as items of their own
export const IMPORT_SOURCES = ["raindrop", "markdown"] as const;
export const IMPORT_STATES = ["running", "done", "failed", "cancelled"] as const;
export const IMPORT_PHASES = ["reading", "landing", "files"] as const;

// a CHECK's list, spelled from the vocabulary it holds a column to
const oneOf = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

// `remove_diacritics 2` and `_` as a token character are stated, not defaulted: the search
// policy's tokenizer folds and splits the same way (`@repo/notes/knowledge/search-query`). The
// row id is the item's `rid`, so a write replaces its row in place.
const SEARCH_DDL = `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title, headings, meta, body,
  title_stems, heading_stems, meta_stems, body_stems,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
)`;

// a purged item keeps its id, sequence and deletion as a tombstone forever and nulls the rest, so
// no id is ever made again, an import's or a late save's included; every other row holds its
// whole record
const ITEMS_DDL = `CREATE TABLE IF NOT EXISTS items (
  rid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT CHECK (kind IN (${oneOf(ITEM_KINDS)})),
  title TEXT,
  folder_id TEXT,
  aliases TEXT,
  tags TEXT,
  properties TEXT,
  url TEXT,
  url_key TEXT,
  site TEXT,
  author TEXT,
  published TEXT,
  description TEXT,
  lang TEXT,
  cover_sha TEXT,
  original_sha TEXT,
  original_name TEXT,
  fetch_state TEXT CHECK (fetch_state IN (${oneOf(FETCH_STATES)})),
  fetched_at INTEGER,
  fetch_error TEXT,
  saved_at INTEGER,
  updated_at INTEGER NOT NULL,
  pinned_at INTEGER,
  deleted_at INTEGER,
  purged INTEGER NOT NULL DEFAULT 0 CHECK (purged IN (0, 1)),
  card TEXT,
  seq INTEGER NOT NULL,
  CHECK (purged = 1 OR (kind IS NOT NULL AND title IS NOT NULL AND aliases IS NOT NULL
    AND tags IS NOT NULL AND properties IS NOT NULL AND fetch_state IS NOT NULL
    AND saved_at IS NOT NULL AND card IS NOT NULL))
) STRICT`;

const LIBRARY_DDL = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v ANY) STRICT, WITHOUT ROWID`,
  ITEMS_DDL,
  // one url, one live item
  `CREATE UNIQUE INDEX IF NOT EXISTS one_url ON items (url_key)
     WHERE deleted_at IS NULL AND url_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS items_seq ON items (seq)`,
  `CREATE TABLE IF NOT EXISTS blocks (
    item_id TEXT NOT NULL,
    block_id TEXT NOT NULL,
    ord TEXT NOT NULL,
    section TEXT NOT NULL CHECK (section IN (${oneOf(LIBRARY_SECTIONS)})),
    json TEXT NOT NULL,
    hash TEXT NOT NULL,
    text TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (item_id, block_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort TEXT NOT NULL,
    deleted_at INTEGER,
    seq INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN (${oneOf(TAG_ORIGINS)})),
    PRIMARY KEY (item_id, tag, origin)
  ) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS item_tags_tag ON item_tags (tag)`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL,
    target_id TEXT,
    target_key TEXT
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS links_source ON links (source_id)`,
  `CREATE INDEX IF NOT EXISTS links_target ON links (target_id)`,
  `CREATE INDEX IF NOT EXISTS links_key ON links (target_key)`,
  SEARCH_DDL,
  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS thread_events (
    event_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    type TEXT NOT NULL,
    json TEXT NOT NULL,
    at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS thread_events_thread ON thread_events (thread_id, idx)`,
  // the files the cell holds and the items naming each, which no device reads, since a device
  // asks for a file by the sha an item's row names; change sets, the op ledger, the uploads it
  // holds room for, the built-in agent, imports and exports, and the jobs its alarm runs. A change
  // set's item names its before and after by part: an item's fields and its manifest (each
  // block's id, hash, order key and section) are each kept once per item under their content hash
  // (`snapshot_parts`), so a set that changed one block stores one new manifest and nothing else,
  // and no row nears a Durable Object's 2 MB. A set's after is null while the set is open and the
  // item is as it left it; it is written when the set seals, or when another set is about to
  // change the item. A block a write replaces or drops keeps its content in `block_versions`,
  // which the prune job sweeps of what no part names
  `CREATE TABLE IF NOT EXISTS blobs (
    sha256 TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    mime TEXT NOT NULL,
    refs INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS item_blobs (
    item_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    PRIMARY KEY (item_id, sha256)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS change_sets (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL
      CHECK (actor IN (${oneOf(CHANGE_SET_ACTORS)})),
    actor_id TEXT,
    label TEXT NOT NULL,
    device_id TEXT,
    thread_id TEXT,
    turn INTEGER,
    client_id TEXT,
    opened_at INTEGER NOT NULL,
    touched_at INTEGER NOT NULL,
    sealed_at INTEGER,
    undone_by TEXT
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS change_sets_open ON change_sets (actor, sealed_at)`,
  `CREATE TABLE IF NOT EXISTS change_set_items (
    change_set_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created INTEGER NOT NULL CHECK (created IN (0, 1)),
    before_fields TEXT,
    before_manifest TEXT,
    after_fields TEXT,
    after_manifest TEXT,
    PRIMARY KEY (change_set_id, item_id),
    CHECK ((created = 1) = (before_fields IS NULL)),
    CHECK ((before_fields IS NULL) = (before_manifest IS NULL)),
    CHECK ((after_fields IS NULL) = (after_manifest IS NULL))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS change_set_items_item ON change_set_items (item_id)`,
  `CREATE TABLE IF NOT EXISTS snapshot_parts (
    item_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (item_id, hash)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS block_versions (
    item_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (item_id, hash)
  ) STRICT`,
  // the files each fields part and block version names, so whether any change set still holds a
  // file is one lookup, never a read of the parts themselves
  `CREATE TABLE IF NOT EXISTS history_blobs (
    item_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    PRIMARY KEY (item_id, hash, sha256)
  ) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS history_blobs_sha ON history_blobs (sha256)`,
  `CREATE TABLE IF NOT EXISTS applied_ops (
    op_id TEXT PRIMARY KEY,
    answer TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS applied_ops_at ON applied_ops (at)`,
  `CREATE TABLE IF NOT EXISTS blob_uploads (
    sha256 TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    mime TEXT NOT NULL
  ) STRICT`,
  // the built-in agent's switch: no row is on, the default, since there is no credential to make
  `CREATE TABLE IF NOT EXISTS agent_switch (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
  ) STRICT`,
  // each thread's open turn, at most one: its number in the thread, which keys the change set its
  // writes open, what the person sent, how many of its calls wait on the person, whether the
  // person stopped it, and when its conversation's object was last heard from, which the watch job
  // asks after
  `CREATE TABLE IF NOT EXISTS agent_turns (
    thread_id TEXT PRIMARY KEY,
    turn INTEGER NOT NULL,
    message TEXT NOT NULL,
    waiting INTEGER NOT NULL DEFAULT 0 CHECK (waiting >= 0),
    cancel INTEGER NOT NULL DEFAULT 0 CHECK (cancel IN (0, 1)),
    started_at INTEGER NOT NULL,
    heard_at INTEGER NOT NULL
  ) STRICT`,
  // every model call a turn reserved before it was sent: what it may spend, in micro-cents, and
  // once its reply or its cut is pushed what it cost, on the day it was reserved; a call cut short
  // reports no usage, so it is booked at what it reserved and marked cut
  `CREATE TABLE IF NOT EXISTS agent_calls (
    call_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    day TEXT NOT NULL,
    reserved_ucents INTEGER NOT NULL,
    max_tokens INTEGER NOT NULL,
    cost_ucents INTEGER,
    cut INTEGER NOT NULL DEFAULT 0 CHECK (cut IN (0, 1))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS agent_calls_turn ON agent_calls (thread_id, turn)`,
  `CREATE INDEX IF NOT EXISTS agent_calls_open ON agent_calls (cost_ucents)`,
  // the last push each thread's object landed, so a push sent again lands nothing
  `CREATE TABLE IF NOT EXISTS agent_pushes (
    thread_id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL
  ) STRICT`,
  // the sends that wait for their thread's turn, or for one of the account's turns at once, oldest
  // first
  `CREATE TABLE IF NOT EXISTS agent_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    message TEXT NOT NULL,
    queued_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS agent_queue_order ON agent_queue (queued_at, id)`,
  // what the built-in agent spent on each UTC day: its turns, and their calls' list cost in
  // micro-cents
  `CREATE TABLE IF NOT EXISTS agent_usage (
    day TEXT PRIMARY KEY,
    turns INTEGER NOT NULL,
    cost_ucents INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN (${oneOf(IMPORT_SOURCES)})),
    sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (${oneOf(IMPORT_STATES)})),
    phase TEXT NOT NULL CHECK (phase IN (${oneOf(IMPORT_PHASES)})),
    cursor INTEGER NOT NULL,
    total INTEGER NOT NULL,
    added INTEGER NOT NULL,
    already_saved INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    unreadable INTEGER NOT NULL,
    change_set_id TEXT,
    message TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  ) STRICT`,
  // a running import's plan, a row per thing it lands, so a page reads only its own rows
  `CREATE TABLE IF NOT EXISTS import_rows (
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    idx INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (job_id, kind, idx)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_at INTEGER
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS jobs_next ON jobs (next_at)`,
] as const;

// what open found: a schema it made, the current one, or one of another version (or none it can
// read) that its host starts over
export type SchemaVerdict =
  | { readonly kind: "created" }
  | { readonly kind: "current" }
  | { readonly kind: "mismatch"; readonly found: string };

const countRow = z.object({ tables: z.number() });
const schemaRow = z.object({ v: z.union([z.string(), z.number()]) });

const firstRow = <T>(rows: readonly SqlRow[], schema: z.ZodType<T>): T | null => {
  const parsed = schema.safeParse(rows[0]);
  return parsed.success ? parsed.data : null;
};

const createAll = function* createAll(): SqlPlan<void> {
  for (const statement of LIBRARY_DDL) {
    yield run(statement);
  }
  yield run("INSERT INTO meta (k, v) VALUES ('schema', ?)", [LIBRARY_SCHEMA_VERSION]);
};

// one `meta.schema` check, then CREATE … IF NOT EXISTS on an empty database; run it in one
// transaction, at open and never per request. It asks the engine nothing, since a Durable Object
// refuses sqlite_version() ("not authorized to use function"), and STRICT tables need only the
// platform's own SQLite
export const ensureLibrarySchema = function* ensureLibrarySchema(): SqlPlan<SchemaVerdict> {
  const meta = yield all(
    "SELECT count(*) AS tables FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
  );
  if (firstRow(meta, countRow)?.tables === 0) {
    const others = yield all(
      "SELECT count(*) AS tables FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'blocks')",
    );
    if (firstRow(others, countRow)?.tables !== 0) {
      return { found: "none", kind: "mismatch" };
    }
    yield* createAll();
    return { kind: "created" };
  }
  let rows: readonly SqlRow[];
  try {
    rows = yield all("SELECT v FROM meta WHERE k = 'schema'");
  } catch {
    // a meta table of another shape: whatever made it, it is not this schema
    return { found: "unreadable", kind: "mismatch" };
  }
  const stored = firstRow(rows, schemaRow);
  const found = stored === null ? "none" : String(stored.v);
  return found === String(LIBRARY_SCHEMA_VERSION)
    ? { kind: "current" }
    : { found, kind: "mismatch" };
};
