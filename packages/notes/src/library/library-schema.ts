// The one schema of the library's SQLite, which the cell and both device replicas create alike:
// the synced tables every engine holds, and the cell's own beside them. Its version is the
// `schema` row of `meta`, never SQLite's own version pragma, which a Durable Object refuses
// (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
// There is no migration: an engine that finds another version answers `mismatch`, and its host
// starts it over (a replica pulls again from nothing).

import { z } from "zod";

import { ANNOTATION_SOURCES } from "../annotations/store-schema";
import { ITEM_KINDS } from "../items/item-kind";
import { LIBRARY_LINK_KINDS } from "./derive-item";
import { FETCH_STATES } from "./library-item";
import { LIBRARY_SECTIONS } from "./library-nodes";
import { all, run } from "./library-sql";
import type { SqlPlan, SqlRow } from "./library-sql";

// bump on any change below
export const LIBRARY_SCHEMA_VERSION = 4;

// STRICT tables are SQLite 3.37; a replica's engine is checked against it at open. The cell's is
// the platform's own, and a Durable Object refuses sqlite_version() ("not authorized to use
// function"), so the cell asks nothing
const LIBRARY_SQLITE_MIN_VERSION = "3.37.0";

// what the change log names a row by
export const LIBRARY_CHANGE_KINDS = [
  "item",
  "folder",
  "annotation",
  "blob",
  "thread",
  "thread_event",
] as const;
export type LibraryChangeKind = (typeof LIBRARY_CHANGE_KINDS)[number];

const TAG_ORIGINS = ["field", "inline"] as const;
// what an item holds a file as: its original, its cover, a thumbnail, its page copy, or an image
// or file its body embeds
export const BLOB_ROLES = ["original", "cover", "thumb", "copy", "embed"] as const;
export type BlobRole = (typeof BLOB_ROLES)[number];
// who a change set is by: the person, the built-in agent, a connected assistant, an import, the
// cloud reading a page, an undo, or the library itself (a dangling link resolving)
export const CHANGE_SET_ACTORS = [
  "person",
  "agent",
  "assistant",
  "import",
  "fill",
  "undo",
  "system",
] as const;

// what an import reads (a Raindrop export, a folder of markdown zipped, Obsidian's included), where
// a job stands, and the phase a running one is in: reading the file into its plan, landing its
// items a page at a time, then the files no item embedded as items of their own
export const IMPORT_SOURCES = ["raindrop", "markdown"] as const;
export const IMPORT_STATES = ["running", "done", "failed", "cancelled"] as const;
export const IMPORT_PHASES = ["reading", "landing", "files"] as const;
// an export is written, then ready to download until it is let go; one being written plans every
// item's file, then writes the items, then the files they hold, then the zip's directory
export const EXPORT_STATES = ["writing", "ready", "failed", "expired"] as const;
export const EXPORT_PHASES = ["plan", "docs", "files", "directory"] as const;

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

// a purged item keeps its id, sequence and deletion as a tombstone forever and nulls the rest,
// so a replica can never miss a deletion; every other row holds its whole record
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
  copy_sha TEXT,
  fetch_state TEXT CHECK (fetch_state IN (${oneOf(FETCH_STATES)})),
  fetched_at INTEGER,
  fetch_error TEXT,
  saved_at INTEGER,
  updated_at INTEGER NOT NULL,
  pinned_at INTEGER,
  deleted_at INTEGER,
  purged INTEGER NOT NULL DEFAULT 0 CHECK (purged IN (0, 1)),
  card TEXT,
  schema INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  CHECK (purged = 1 OR (kind IS NOT NULL AND title IS NOT NULL AND aliases IS NOT NULL
    AND tags IS NOT NULL AND properties IS NOT NULL AND fetch_state IS NOT NULL
    AND saved_at IS NOT NULL AND card IS NOT NULL))
) STRICT`;

// the synced tables: what a replica pulls and every screen reads
const SYNCED_DDL = [
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
    annotation_ids TEXT NOT NULL,
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
    block_id TEXT NOT NULL,
    target_id TEXT,
    target_key TEXT,
    heading TEXT,
    block_ref TEXT,
    kind TEXT NOT NULL CHECK (kind IN (${oneOf(LIBRARY_LINK_KINDS)})),
    section TEXT NOT NULL CHECK (section IN (${oneOf(LIBRARY_SECTIONS)}))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS links_source ON links (source_id)`,
  `CREATE INDEX IF NOT EXISTS links_target ON links (target_id)`,
  `CREATE INDEX IF NOT EXISTS links_key ON links (target_key)`,
  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    parent_id TEXT,
    text TEXT NOT NULL,
    quote TEXT,
    occurrence INTEGER,
    source TEXT CHECK (source IN (${oneOf(ANNOTATION_SOURCES)})),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    seq INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS annotations_item ON annotations (item_id)`,
  `CREATE TABLE IF NOT EXISTS blobs (
    sha256 TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    mime TEXT NOT NULL,
    w INTEGER,
    h INTEGER,
    refs INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS item_blobs (
    item_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN (${oneOf(BLOB_ROLES)})),
    PRIMARY KEY (item_id, sha256, role)
  ) STRICT, WITHOUT ROWID`,
  SEARCH_DDL,
  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    session_id TEXT,
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
  `CREATE TABLE IF NOT EXISTS changes (
    kind TEXT NOT NULL CHECK (kind IN (${oneOf(LIBRARY_CHANGE_KINDS)})),
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    gone INTEGER NOT NULL DEFAULT 0 CHECK (gone IN (0, 1)),
    PRIMARY KEY (kind, id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS changes_seq ON changes (seq)`,
] as const;

// the cell's alone: History, the op ledger, the uploads it holds room for, the built-in agent,
// imports and exports, and the jobs its alarm runs. A change set's item names its before and after
// by part: an item's fields, its manifest (each block's id, hash, order key and section) and its
// highlights are each kept once per item under their content hash (`snapshot_parts`), so a
// revision that changed one block stores one new manifest and nothing else, and no row nears a
// Durable Object's 2 MB. A set's after is null while the set is open and the item is as it left
// it; it is written when the set seals, or when another set is about to change the item. A block a
// write replaces or drops keeps its content in `block_versions`, which the prune job sweeps of what
// no part names.
const CELL_DDL = [
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
    before_annotations TEXT,
    after_fields TEXT,
    after_manifest TEXT,
    after_annotations TEXT,
    PRIMARY KEY (change_set_id, item_id),
    CHECK ((created = 1) = (before_fields IS NULL)),
    CHECK ((before_fields IS NULL) = (before_manifest IS NULL)
      AND (before_fields IS NULL) = (before_annotations IS NULL)),
    CHECK ((after_fields IS NULL) = (after_manifest IS NULL)
      AND (after_fields IS NULL) = (after_annotations IS NULL))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS change_set_items_item ON change_set_items (item_id)`,
  `CREATE TABLE IF NOT EXISTS revisions (
    item_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    change_set_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    fields TEXT NOT NULL,
    manifest TEXT NOT NULL,
    PRIMARY KEY (item_id, rev)
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS revisions_set ON revisions (change_set_id)`,
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
  `CREATE TABLE IF NOT EXISTS applied_ops (
    op_id TEXT PRIMARY KEY,
    change_set_id TEXT,
    answer TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS applied_ops_at ON applied_ops (at)`,
  `CREATE TABLE IF NOT EXISTS blob_uploads (
    sha256 TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    mime TEXT NOT NULL,
    reserved_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS agent_vault (
    account_id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    grant_id TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS agent_turn (
    thread_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    change_set_id TEXT NOT NULL,
    last_event_id TEXT,
    started_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS agent_usage (
    day TEXT PRIMARY KEY,
    turns INTEGER NOT NULL,
    input INTEGER NOT NULL,
    cached INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cost_micros INTEGER NOT NULL
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
    highlights INTEGER NOT NULL,
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
  // an export, and while it is written where its writer stands: the phase and its cursor, the
  // multipart upload and the length of its parts, and the zip's bytes, parts and entries so far
  `CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN (${oneOf(EXPORT_STATES)})),
    phase TEXT NOT NULL CHECK (phase IN (${oneOf(EXPORT_PHASES)})),
    cursor INTEGER NOT NULL,
    upload_id TEXT,
    part_bytes INTEGER,
    written INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    bytes INTEGER,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    expires_at INTEGER,
    message TEXT
  ) STRICT`,
  // an export's plan and the zip's records, a row per thing by its kind, so each run of the alarm
  // reads only what it writes: the paths taken, the folders' and the items' files, the items filed
  // under each key a link resolves by, the files the items hold, the directory's entries and the
  // uploaded parts, each found by its key or read in its order
  `CREATE TABLE IF NOT EXISTS export_rows (
    export_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    idx INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (export_id, kind, key, idx)
  ) STRICT, WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS export_rows_order ON export_rows (export_id, kind, idx)`,
  // the zip's bytes past its last whole part, which the next run's first part begins with, in
  // base64 chunks under a row's 2 MB, since the library's SQL binds no bytes
  `CREATE TABLE IF NOT EXISTS export_tail (
    export_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    base64 TEXT NOT NULL,
    PRIMARY KEY (export_id, idx)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_at INTEGER
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS jobs_next ON jobs (next_at)`,
] as const;

export type LibraryRole = "cell" | "replica";

export const libraryDdl = (role: LibraryRole): readonly string[] =>
  role === "cell" ? [...SYNCED_DDL, ...CELL_DDL] : SYNCED_DDL;

// what open found: a schema it made, the current one, one of another version (or none it can
// read) that its host starts over, or an engine older than the schema needs
export type SchemaVerdict =
  | { readonly kind: "created" }
  | { readonly kind: "current" }
  | { readonly kind: "mismatch"; readonly found: string }
  | { readonly kind: "unsupported"; readonly sqliteVersion: string };

const versionParts = (version: string): number[] =>
  version.split(".").map((part) => Math.trunc(Number(part)) || 0);

export const sqliteVersionAtLeast = (version: string, floor: string): boolean => {
  const have = versionParts(version);
  const need = versionParts(floor);
  for (let index = 0; index < Math.max(have.length, need.length); index += 1) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return true;
};

const versionRow = z.object({ version: z.string() });
const countRow = z.object({ tables: z.number() });
const schemaRow = z.object({ v: z.union([z.string(), z.number()]) });

const firstRow = <T>(rows: readonly SqlRow[], schema: z.ZodType<T>): T | null => {
  const parsed = schema.safeParse(rows[0]);
  return parsed.success ? parsed.data : null;
};

const createAll = function* createAll(role: LibraryRole): SqlPlan<void> {
  for (const statement of libraryDdl(role)) {
    yield run(statement);
  }
  yield run("INSERT INTO meta (k, v) VALUES ('schema', ?)", [LIBRARY_SCHEMA_VERSION]);
};

// a replica's engine-version check, then one `meta.schema` check, then CREATE … IF NOT EXISTS on
// an empty database; run it in one transaction, at open and never per request
export const ensureLibrarySchema = function* ensureLibrarySchema(
  role: LibraryRole,
): SqlPlan<SchemaVerdict> {
  if (role === "replica") {
    const sqliteVersion =
      firstRow(yield all("SELECT sqlite_version() AS version"), versionRow)?.version ?? "";
    if (!sqliteVersionAtLeast(sqliteVersion, LIBRARY_SQLITE_MIN_VERSION)) {
      return { kind: "unsupported", sqliteVersion };
    }
  }
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
    yield* createAll(role);
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
