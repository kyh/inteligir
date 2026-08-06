// ---------------------------------------------------------------------------
// The SQL KnowledgeStore — schema, guards, and queries written ONCE over an
// injected SqlDriver (engine.ts's injected-port precedent), so desktop
// (node:sqlite), the dev harness (SQLite wasm) and the cloud host (Durable
// Object storage) run the IDENTICAL migrations and bm25 search. Only the
// byte-level binding is per-platform — plus the two statements a platform may
// refuse to accept as SQL at all, which the driver may own instead
// (SqlDriver.transaction / .schemaVersion).
//
// Versioning is deliberately trivial — single-version wipe-and-rebuild, three
// guards checked at open: PRAGMA user_version vs KNOWLEDGE_SCHEMA_VERSION,
// meta.projection_version vs core's PROJECTION_VERSION, and meta.vault_root
// vs the actual root (path-hash collision / moved-vault guard). Any mismatch,
// open failure, or malformed row → driver.reset() + fresh schema. That is
// always safe because of the KnowledgeStore law: the DB is a CACHE, nothing
// durable ever lives in it.
//
// Search: FTS5 over (title, headings, body), unicode61 with `_` kept as a
// token char to match core tokenize(); queries AND quoted tokens with the
// last as a prefix (search-as-you-type), ranked by weighted bm25 mirroring
// the pure index's TITLE/HEADING/BODY weights (10/4/1).
//
// Hydration is PAGED. Every SQLite binding on every target platform is
// synchronous, so a whole-corpus read is an uninterruptible stall on whatever
// thread calls it — measured at 1.2s on a synthetic 50k-note vault, where the
// six full-table sweeps materialize ~1M row objects in one call. `hydrate()`
// hands back a resumable keyset cursor instead: each `next()` reads ONE bounded
// page (a `files` slice plus the five child ranges that slice covers), so the
// cost of a single synchronous call is a function of the page size, never of
// the corpus. The host shell drives it with event-loop yields between pages.
// `loadAll()` (the port's one-shot contract) is that same cursor, drained.
// ---------------------------------------------------------------------------

import type { SearchResult } from "./knowledge-index";
import type { KnowledgeStore, StoredDocRow, StoredFingerprint } from "./knowledge-store";
import type { ExtractedTask } from "./link-extract";
import type { DocProjection, StoredLink } from "./projection";
import { PROJECTION_VERSION } from "./projection";
import { tokenize } from "./search-index";

/** Bump on any DDL change — an older/newer file is wiped and rebuilt. */
export const KNOWLEDGE_SCHEMA_VERSION = 7;

/** What the store binds/reads. SQLite NULL/REAL/INTEGER/TEXT — no blobs. */
export type SqlValue = null | number | string;

export type SqlRow = Record<string, unknown>;

/** The per-platform SQLite binding. Implementations own the file/instance
 * lifecycle; the store owns every statement that runs through it.
 *
 * The last two members are optional because they name the only two things a
 * platform can refuse to express as SQL. Durable Object storage refuses BOTH:
 * it answers SQLITE_AUTH to `PRAGMA user_version` and rejects
 * `BEGIN`/`SAVEPOINT` outright (it owns write coalescing and offers
 * `transactionSync` instead). A driver that leaves them unset gets the plain
 * SQL path, which is what every file-backed binding wants. */
export type SqlDriver = {
  /** Execute one or more statements with no parameters or results. */
  exec(sql: string): void;
  /** Execute one parameterized statement, discarding any rows. */
  run(sql: string, params: readonly SqlValue[]): void;
  /** Execute one parameterized query, returning all rows keyed by column. */
  all(sql: string, params: readonly SqlValue[]): SqlRow[];
  /** Destroy the database entirely (close + delete files, or drop the
   * in-memory instance) and reopen empty — the recovery primitive. */
  reset(): void;
  close(): void;
  /** Run `fn` as one atomic unit, rolling back if it throws. Bound only where
   * the platform's own API must own the transaction. */
  transaction?(fn: () => void): void;
  /** Read/write the schema version where `PRAGMA user_version` is unavailable.
   * `read()` answers 0 for a database that has never carried one. */
  schemaVersion?: { read(): number; write(version: number): void };
};

// ---- Paged hydration ----------------------------------------------------------

/** One bounded slice of the persisted projection. Docs come first, in path
 * order, then the non-doc files — a page is one or the other, never a mix, so
 * a consumer replaying pages sees exactly `loadAll()`'s ordering. */
export type HydrationPage =
  | { kind: "docs"; docs: StoredDocRow[] }
  | { kind: "others"; others: { path: string }[] }
  | { kind: "done" };

/** A resumable read of everything persisted. `next()` is the only synchronous
 * unit of work — call it until it answers `done`, yielding in between. A
 * cursor reads through the live DB, so it must be abandoned (not resumed)
 * after a write, a `nuke()`, or a `dispose()`. */
export type HydrationCursor = {
  next(): HydrationPage;
};

/** The SQL store: the `KnowledgeStore` port plus the paged hydration only a
 * SQL-backed store can offer. The port stays implementation-neutral (a store
 * that can only answer `loadAll()` is still a valid store); a host shell that
 * wants to hydrate without stalling asks for THIS type. */
export type SqlKnowledgeStore = KnowledgeStore & {
  /** Open a resumable read of the persisted projection, at most `pageDocs`
   * docs (and their child rows) per `next()`. */
  hydrate(pageDocs: number): HydrationCursor;
};

// ---- Schema -------------------------------------------------------------------

// Column layout mirrors DocProjection: files carries identity + fingerprint +
// content hash; links/headings/tags/aliases are ord-keyed child rows
// (deterministic rebuild output); search_fts holds the ONLY copy of doc
// bodies. Sibling workstreams extend by adding a projection field + a child
// table here and bumping PROJECTION_VERSION — the wipe-and-rebuild guard IS
// the migration.
//
// Child rows are read only by hydration's per-table ORDER BY sweeps (boot) —
// link/tag/name RESOLUTION happens entirely in the in-memory LinkGraphIndex,
// so the schema carries no lookup indexes or derived key columns beyond the
// PKs. Those PKs are what makes paged hydration cheap: every child table is
// keyed (path, ord), so a page's `path > ? AND path <= ?` window is an index
// range scan, not a filtered table sweep.
const SCHEMA_DDL = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('doc', 'other')),
  title TEXT,
  content_hash TEXT,
  mtime_ms REAL,
  size INTEGER,
  ino INTEGER,
  is_private INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE links (
  source_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('wiki', 'md', 'image')),
  embed INTEGER NOT NULL,
  target TEXT NOT NULL,
  anchor TEXT,
  alias TEXT,
  line INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  target_span_start INTEGER,
  target_span_end INTEGER,
  PRIMARY KEY (source_path, ord)
);
CREATE TABLE headings (
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (path, ord)
);
CREATE TABLE tags (
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (path, ord)
);
CREATE TABLE aliases (
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (path, ord)
);
CREATE TABLE tasks (
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  line INTEGER NOT NULL,
  raw TEXT NOT NULL,
  text TEXT NOT NULL,
  checked INTEGER NOT NULL,
  wiki_targets TEXT NOT NULL,
  PRIMARY KEY (path, ordinal)
);
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, headings, body, path UNINDEXED, is_private UNINDEXED,
  tokenize='unicode61 tokenchars ''_'''
);
`;

// bm25() returns lower-is-better (negative) ranks; weights mirror the pure
// SearchIndex's TITLE_WEIGHT/HEADING_WEIGHT/BODY_WEIGHT so a title hit beats a
// body-only hit. Path tiebreak keeps ordering deterministic.
//
// The renderer's search and the agent's differ by ONE extra WHERE term, so both
// are cut from this template: the bm25 weights and the snippet config MUST
// agree between them, or the agent ranks and quotes hits differently from what
// the user sees. That term is the only interpolation and both call sites pass a
// literal — every VALUE still binds through `?`.
const searchSql = (privacyTerm: string): string => `
SELECT path, title,
  snippet(search_fts, 2, '', '', '…', 12) AS snip,
  bm25(search_fts, 10.0, 4.0, 1.0) AS rank
FROM search_fts
WHERE search_fts MATCH ?${privacyTerm}
ORDER BY rank, path
LIMIT ?
`;

const SEARCH_SQL = searchSql("");

// The agent-facing variant: `private: true` docs are excluded INSIDE the query,
// so the limit applies to public hits and a private path/snippet can never even
// transit the result set.
//
// The flag is carried as an UNINDEXED FTS5 column rather than joined from
// `files`, which is correctness-neutral and a large cost difference: an
// `IN (SELECT rowid FROM files WHERE is_private = 0)` term against a MATCH
// query is QUADRATIC in corpus size (SQLite re-drives the row list per matched
// row) — at 4k docs a term appearing in every note took 1.1s, at 50k it took
// 198s, against ~77ms for the same query unfiltered. As a stored column the
// filter is a residual test on rows the cursor already produced, so the
// agent-facing search costs what the renderer's does.
const SEARCH_PUBLIC_SQL = searchSql(" AND is_private = 0");

// Hydration reads. Both `files` pages are keyset-paginated (`path > ?` against
// the PK index) rather than OFFSET-paginated, so page N costs the same as page
// 0. The five child reads take the page's own [after, last] path window; every
// child row in that window belongs to a doc in the page, because non-doc files
// never keep child rows (upsertOther deletes them).
const DOC_PAGE_SQL = `
SELECT path, title, content_hash, mtime_ms, size, ino, is_private
FROM files WHERE kind = 'doc' AND path > ? ORDER BY path LIMIT ?
`;
const OTHER_PAGE_SQL = `
SELECT path FROM files WHERE kind = 'other' AND path > ? ORDER BY path LIMIT ?
`;
const LINKS_RANGE_SQL = `
SELECT source_path, kind, embed, target, anchor, alias, line, snippet,
       target_span_start, target_span_end
FROM links WHERE source_path > ? AND source_path <= ? ORDER BY source_path, ord
`;
const HEADINGS_RANGE_SQL = `
SELECT path, text FROM headings WHERE path > ? AND path <= ? ORDER BY path, ord
`;
const TAGS_RANGE_SQL = `
SELECT path, tag FROM tags WHERE path > ? AND path <= ? ORDER BY path, ord
`;
const ALIASES_RANGE_SQL = `
SELECT path, alias FROM aliases WHERE path > ? AND path <= ? ORDER BY path, ord
`;
const TASKS_RANGE_SQL = `
SELECT path, ordinal, line, raw, text, checked, wiki_targets
FROM tasks WHERE path > ? AND path <= ? ORDER BY path, ordinal
`;

/** Keyset start: every vault path is non-empty, so "" precedes all of them. */
const PATH_START = "";

/** Page size `loadAll()` drains at. Only a batching detail — the whole result
 * is materialized either way — sized so the intermediate arrays stay small
 * without paying a per-page query round-trip for every few rows. */
const HYDRATION_DRAIN_PAGE_DOCS = 1000;

/** Core tokenize() → an FTS5 MATCH expression: quoted tokens ANDed, the last
 * one prefix-matched (search-as-you-type). Null when the query has no tokens. */
export function buildFtsMatchQuery(query: string): string | null {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return null;
  return tokens
    .map((token, i) => (i === tokens.length - 1 ? `"${token}" *` : `"${token}"`))
    .join(" ");
}

// ---- Row parsing (SQL boundary) ------------------------------------------------

function columnNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new Error(`knowledge-store: column ${key} is not a number`);
}

function columnString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`knowledge-store: column ${key} is not text`);
}

function columnStringOrNull(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`knowledge-store: column ${key} is not text/null`);
}

function columnNumberOrNull(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  throw new Error(`knowledge-store: column ${key} is not a number/null`);
}

function parseLinkKind(value: string): StoredLink["kind"] {
  if (value === "wiki" || value === "md" || value === "image") return value;
  throw new Error(`knowledge-store: unknown link kind ${value}`);
}

/** The `wiki_targets` column is a JSON string array — parse at the SQL
 * boundary like every other column, throwing on any malformed row (the store
 * guards treat that as corruption and wipe-rebuild). */
function parseWikiTargets(row: SqlRow): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(columnString(row, "wiki_targets"));
  } catch {
    throw new Error("knowledge-store: column wiki_targets is not valid JSON");
  }
  if (Array.isArray(parsed) && parsed.every((t): t is string => typeof t === "string")) {
    return parsed;
  }
  throw new Error("knowledge-store: column wiki_targets is not a string array");
}

function parseStoredTask(row: SqlRow): ExtractedTask {
  return {
    checked: columnNumber(row, "checked") !== 0,
    text: columnString(row, "text"),
    raw: columnString(row, "raw"),
    line: columnNumber(row, "line"),
    ordinal: columnNumber(row, "ordinal"),
    wikiTargets: parseWikiTargets(row),
  };
}

function parseStoredLink(row: SqlRow): StoredLink {
  const link: StoredLink = {
    kind: parseLinkKind(columnString(row, "kind")),
    embed: columnNumber(row, "embed") !== 0,
    target: columnString(row, "target"),
    line: columnNumber(row, "line"),
    snippet: columnString(row, "snippet"),
  };
  const anchor = columnStringOrNull(row, "anchor");
  if (anchor !== null) link.anchor = anchor;
  const alias = columnStringOrNull(row, "alias");
  if (alias !== null) link.alias = alias;
  const targetStart = columnNumberOrNull(row, "target_span_start");
  const targetEnd = columnNumberOrNull(row, "target_span_end");
  if (targetStart !== null && targetEnd !== null) {
    link.targetSpan = { start: targetStart, end: targetEnd };
  }
  return link;
}

// ---- Store --------------------------------------------------------------------

/** Bind the shared SQL store over a platform driver. Opens (or recovers) the
 * schema immediately; the returned store is ready to serve. */
export function createSqlKnowledgeStore(driver: SqlDriver, vaultRoot: string): SqlKnowledgeStore {
  let transactionDepth = 0;

  const metaGet = (key: string): string | null => {
    const rows = driver.all("SELECT value FROM meta WHERE key = ?", [key]);
    const first = rows[0];
    return first === undefined ? null : columnString(first, "value");
  };

  const readSchemaVersion = (): number => {
    const owned = driver.schemaVersion;
    if (owned !== undefined) return owned.read();
    const row = driver.all("PRAGMA user_version", [])[0];
    return row === undefined ? 0 : columnNumber(row, "user_version");
  };

  const writeSchemaVersion = (version: number): void => {
    const owned = driver.schemaVersion;
    if (owned !== undefined) {
      owned.write(version);
      return;
    }
    driver.exec(`PRAGMA user_version = ${version}`);
  };

  const initSchema = (): void => {
    driver.exec(SCHEMA_DDL);
    writeSchemaVersion(KNOWLEDGE_SCHEMA_VERSION);
    driver.run(
      "INSERT INTO meta (key, value) VALUES ('projection_version', ?), ('vault_root', ?)",
      [String(PROJECTION_VERSION), vaultRoot],
    );
  };

  const openFresh = (): void => {
    driver.exec("PRAGMA foreign_keys = ON");
    initSchema();
  };

  const open = (): void => {
    try {
      driver.exec("PRAGMA foreign_keys = ON");
      const userVersion = readSchemaVersion();
      const hasMeta =
        driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'", [])
          .length > 0;
      if (userVersion === 0 && !hasMeta) {
        initSchema(); // brand-new file
        return;
      }
      if (userVersion !== KNOWLEDGE_SCHEMA_VERSION) {
        throw new Error(`schema version ${userVersion} != ${KNOWLEDGE_SCHEMA_VERSION}`);
      }
      if (metaGet("projection_version") !== String(PROJECTION_VERSION)) {
        throw new Error("projection version mismatch");
      }
      if (metaGet("vault_root") !== vaultRoot) {
        throw new Error("vault root mismatch");
      }
    } catch (err) {
      // Any guard mismatch or read failure: the file is not OUR current cache.
      // Wipe and rebuild — always safe, nothing durable lives here.
      console.warn("[knowledge-store] discarding index db (will rebuild):", messageOf(err));
      driver.reset();
      openFresh();
    }
  };

  const runStatements = (fn: () => void): void => {
    driver.exec("BEGIN");
    try {
      fn();
      driver.exec("COMMIT");
    } catch (err) {
      try {
        driver.exec("ROLLBACK");
      } catch {
        // The transaction may already be gone (e.g. the failure closed it).
      }
      throw err;
    }
  };

  const transaction = (fn: () => void): void => {
    if (transactionDepth > 0) {
      fn(); // already atomic under the outermost transaction
      return;
    }
    transactionDepth = 1;
    try {
      if (driver.transaction === undefined) runStatements(fn);
      else driver.transaction(fn);
    } finally {
      transactionDepth = 0;
    }
  };

  const rowidOf = (path: string): number | null => {
    const row = driver.all("SELECT rowid FROM files WHERE path = ?", [path])[0];
    return row === undefined ? null : columnNumber(row, "rowid");
  };

  const deleteChildren = (path: string): void => {
    driver.run("DELETE FROM links WHERE source_path = ?", [path]);
    driver.run("DELETE FROM headings WHERE path = ?", [path]);
    driver.run("DELETE FROM tags WHERE path = ?", [path]);
    driver.run("DELETE FROM aliases WHERE path = ?", [path]);
    driver.run("DELETE FROM tasks WHERE path = ?", [path]);
  };

  /** One doc page: the `files` slice after `after`, then the child rows in the
   * exact path window that slice covers. Empty when the corpus is exhausted. */
  const readDocPage = (after: string, limit: number): StoredDocRow[] => {
    const docs = new Map<string, StoredDocRow>();
    for (const row of driver.all(DOC_PAGE_SQL, [after, limit])) {
      const path = columnString(row, "path");
      const projection: DocProjection = {
        title: columnString(row, "title"),
        headings: [],
        links: [],
        tags: [],
        aliases: [],
        private: columnNumber(row, "is_private") !== 0,
        tasks: [],
      };
      docs.set(path, {
        path,
        fingerprint: {
          mtimeMs: columnNumber(row, "mtime_ms"),
          size: columnNumber(row, "size"),
          ino: columnNumber(row, "ino"),
        },
        contentHash: columnString(row, "content_hash"),
        projection,
      });
    }
    // `files.path` is the PRIMARY KEY, so the map never collapses two rows —
    // page.length is the row count, which is what the cursor's "short page
    // ends the phase" test relies on.
    const page = [...docs.values()];
    const last = page[page.length - 1];
    if (last === undefined) return page;
    const pageWindow: readonly SqlValue[] = [after, last.path];
    for (const row of driver.all(LINKS_RANGE_SQL, pageWindow)) {
      docs.get(columnString(row, "source_path"))?.projection.links.push(parseStoredLink(row));
    }
    for (const row of driver.all(HEADINGS_RANGE_SQL, pageWindow)) {
      docs.get(columnString(row, "path"))?.projection.headings.push(columnString(row, "text"));
    }
    for (const row of driver.all(TAGS_RANGE_SQL, pageWindow)) {
      docs.get(columnString(row, "path"))?.projection.tags.push(columnString(row, "tag"));
    }
    for (const row of driver.all(ALIASES_RANGE_SQL, pageWindow)) {
      docs.get(columnString(row, "path"))?.projection.aliases.push(columnString(row, "alias"));
    }
    for (const row of driver.all(TASKS_RANGE_SQL, pageWindow)) {
      docs.get(columnString(row, "path"))?.projection.tasks.push(parseStoredTask(row));
    }
    return page;
  };

  const readOtherPage = (after: string, limit: number): { path: string }[] =>
    driver.all(OTHER_PAGE_SQL, [after, limit]).map((row) => ({ path: columnString(row, "path") }));

  /** Cursor position — a short page ends its phase immediately, so the corpus
   * is never re-queried just to learn it ran out. */
  type HydrationState =
    | { phase: "docs"; after: string }
    | { phase: "others"; after: string }
    | { phase: "done" };

  const hydrate = (pageDocs: number): HydrationCursor => {
    const limit = Math.max(1, Math.floor(pageDocs));
    let state: HydrationState = { phase: "docs", after: PATH_START };
    const next = (): HydrationPage => {
      for (;;) {
        switch (state.phase) {
          case "docs": {
            const docs = readDocPage(state.after, limit);
            const last = docs[docs.length - 1];
            if (last === undefined || docs.length < limit) {
              state = { phase: "others", after: PATH_START };
            } else {
              state = { phase: "docs", after: last.path };
            }
            if (last === undefined) continue; // no docs left — fall into others
            return { kind: "docs", docs };
          }
          case "others": {
            const others = readOtherPage(state.after, limit);
            const last = others[others.length - 1];
            if (last === undefined || others.length < limit) {
              state = { phase: "done" };
            } else {
              state = { phase: "others", after: last.path };
            }
            if (last === undefined) return { kind: "done" };
            return { kind: "others", others };
          }
          case "done":
            return { kind: "done" };
        }
      }
    };
    return { next };
  };

  open();

  return {
    hydrate,

    // The port's one-shot read: the cursor, drained. Callers that can afford
    // to block (tests, a store-level round-trip check) keep the simple shape;
    // the host shell hydrates through `hydrate()` so no single call scales
    // with the corpus.
    loadAll() {
      const cursor = hydrate(HYDRATION_DRAIN_PAGE_DOCS);
      const docs: StoredDocRow[] = [];
      const others: { path: string }[] = [];
      for (;;) {
        const page = cursor.next();
        if (page.kind === "done") return { docs, others };
        if (page.kind === "docs") docs.push(...page.docs);
        else others.push(...page.others);
      }
    },

    upsertDoc(row, body) {
      transaction(() => {
        const { projection } = row;
        driver.run(
          `INSERT INTO files (path, kind, title, content_hash, mtime_ms, size, ino, is_private)
           VALUES (?, 'doc', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             kind = 'doc', title = excluded.title, content_hash = excluded.content_hash,
             mtime_ms = excluded.mtime_ms, size = excluded.size, ino = excluded.ino,
             is_private = excluded.is_private`,
          [
            row.path,
            projection.title,
            row.contentHash,
            row.fingerprint.mtimeMs,
            row.fingerprint.size,
            row.fingerprint.ino,
            projection.private ? 1 : 0,
          ],
        );
        deleteChildren(row.path);
        for (const [ord, link] of projection.links.entries()) {
          driver.run(
            `INSERT INTO links (source_path, ord, kind, embed, target, anchor, alias, line, snippet, target_span_start, target_span_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.path,
              ord,
              link.kind,
              link.embed ? 1 : 0,
              link.target,
              link.anchor ?? null,
              link.alias ?? null,
              link.line,
              link.snippet,
              link.targetSpan?.start ?? null,
              link.targetSpan?.end ?? null,
            ],
          );
        }
        for (const [ord, text] of projection.headings.entries()) {
          driver.run("INSERT INTO headings (path, ord, text) VALUES (?, ?, ?)", [
            row.path,
            ord,
            text,
          ]);
        }
        for (const [ord, tag] of projection.tags.entries()) {
          driver.run("INSERT INTO tags (path, ord, tag) VALUES (?, ?, ?)", [row.path, ord, tag]);
        }
        for (const [ord, alias] of projection.aliases.entries()) {
          driver.run("INSERT INTO aliases (path, ord, alias) VALUES (?, ?, ?)", [
            row.path,
            ord,
            alias,
          ]);
        }
        for (const task of projection.tasks) {
          driver.run(
            `INSERT INTO tasks (path, ordinal, line, raw, text, checked, wiki_targets)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              row.path,
              task.ordinal,
              task.line,
              task.raw,
              task.text,
              task.checked ? 1 : 0,
              JSON.stringify(task.wikiTargets),
            ],
          );
        }
        const rowid = rowidOf(row.path);
        if (rowid === null) throw new Error("knowledge-store: upserted file row vanished");
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run(
          // Aliases ride the headings column — a ranking boost only (the alias
          // bytes already match via the body, which includes the frontmatter),
          // mirroring the pure SearchIndex composition in knowledge-index.ts.
          // `is_private` is stored, not indexed: it is the agent-facing query's
          // filter (see SEARCH_PUBLIC_SQL), never a search term.
          `INSERT INTO search_fts (rowid, title, headings, body, path, is_private)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            rowid,
            projection.title,
            [...projection.headings, ...projection.aliases].join("\n"),
            body,
            row.path,
            projection.private ? 1 : 0,
          ],
        );
      });
    },

    upsertOther(path) {
      transaction(() => {
        const priorRowid = rowidOf(path);
        if (priorRowid !== null) {
          driver.run("DELETE FROM search_fts WHERE rowid = ?", [priorRowid]);
        }
        driver.run(
          `INSERT INTO files (path, kind) VALUES (?, 'other')
           ON CONFLICT(path) DO UPDATE SET
             kind = 'other', title = NULL, content_hash = NULL,
             mtime_ms = NULL, size = NULL, ino = NULL, is_private = 1`,
          [path],
        );
        deleteChildren(path);
      });
    },

    updateFingerprint(path, fingerprint: StoredFingerprint) {
      driver.run("UPDATE files SET mtime_ms = ?, size = ?, ino = ? WHERE path = ?", [
        fingerprint.mtimeMs,
        fingerprint.size,
        fingerprint.ino,
        path,
      ]);
    },

    remove(path) {
      transaction(() => {
        const rowid = rowidOf(path);
        if (rowid === null) return;
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run("DELETE FROM files WHERE path = ?", [path]); // children CASCADE
      });
    },

    clear() {
      transaction(() => {
        driver.run("DELETE FROM search_fts", []);
        driver.run("DELETE FROM files", []); // children CASCADE
      });
    },

    search(query, limit, opts): SearchResult[] {
      const match = buildFtsMatchQuery(query);
      if (match === null || limit <= 0) return [];
      const sql = opts?.excludePrivate === true ? SEARCH_PUBLIC_SQL : SEARCH_SQL;
      return driver.all(sql, [match, limit]).map((row) => {
        const title = columnString(row, "title");
        const snippet = columnString(row, "snip").trim();
        return {
          path: columnString(row, "path"),
          title,
          snippet: snippet === "" ? title : snippet,
          // bm25() ranks lower-is-better (negative); flip so higher is better,
          // matching the pure index's score direction.
          score: -columnNumber(row, "rank"),
        };
      });
    },

    transaction,

    nuke() {
      driver.reset();
      openFresh();
    },

    dispose() {
      driver.close();
    },
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
