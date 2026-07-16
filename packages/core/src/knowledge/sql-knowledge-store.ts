// ---------------------------------------------------------------------------
// The SQL KnowledgeStore — schema, guards, and queries written ONCE over an
// injected SqlDriver (engine.ts's injected-port precedent), so desktop
// (node:sqlite) and the dev harness (SQLite wasm) run the IDENTICAL
// migrations and bm25 search. Only the byte-level binding is per-platform.
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
// ---------------------------------------------------------------------------

import type { SearchResult } from "./knowledge-index";
import type { KnowledgeStore, StoredDocRow, StoredFingerprint } from "./knowledge-store";
import type { DocProjection, StoredLink } from "./projection";
import { PROJECTION_VERSION } from "./projection";
import { tokenize } from "./search-index";

/** Bump on any DDL change — an older/newer file is wiped and rebuilt. */
export const KNOWLEDGE_SCHEMA_VERSION = 2; // 2: files gained is_private

/** What the store binds/reads. SQLite NULL/REAL/INTEGER/TEXT — no blobs. */
export type SqlValue = null | number | string;

export type SqlRow = Record<string, unknown>;

/** The per-platform SQLite binding. Implementations own the file/instance
 * lifecycle; the store owns every statement that runs through it. */
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
};

// ---- Schema -------------------------------------------------------------------

// Column layout mirrors DocProjection: files carries identity + fingerprint +
// content hash; links/headings/tags are ord-keyed child rows (deterministic
// rebuild output); search_fts holds the ONLY copy of doc bodies. Sibling
// workstreams extend by adding a projection field + a child table here and
// bumping PROJECTION_VERSION — the wipe-and-rebuild guard IS the migration.
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
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  target_span_start INTEGER,
  target_span_end INTEGER,
  PRIMARY KEY (source_path, ord)
);
CREATE INDEX links_target ON links(target);
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
CREATE INDEX tags_tag ON tags(tag COLLATE NOCASE);
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, headings, body, path UNINDEXED,
  tokenize='unicode61 tokenchars ''_'''
);
`;

// bm25() returns lower-is-better (negative) ranks; weights mirror the pure
// SearchIndex's TITLE_WEIGHT/HEADING_WEIGHT/BODY_WEIGHT so a title hit beats a
// body-only hit. Path tiebreak keeps ordering deterministic.
const SEARCH_SQL = `
SELECT path, title,
  snippet(search_fts, 2, '', '', '…', 12) AS snip,
  bm25(search_fts, 10.0, 4.0, 1.0) AS rank
FROM search_fts
WHERE search_fts MATCH ?
ORDER BY rank, path
LIMIT ?
`;

// The agent-facing variant: `private: true` docs are excluded INSIDE the query
// (search_fts shares rowids with files), so the limit applies to public hits
// and a private path/snippet can never even transit the result set. Column
// default is 1 (private-until-parsed) — an unparsed row is excluded too.
const SEARCH_PUBLIC_SQL = `
SELECT path, title,
  snippet(search_fts, 2, '', '', '…', 12) AS snip,
  bm25(search_fts, 10.0, 4.0, 1.0) AS rank
FROM search_fts
WHERE search_fts MATCH ?
  AND rowid IN (SELECT rowid FROM files WHERE is_private = 0)
ORDER BY rank, path
LIMIT ?
`;

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

function parseStoredLink(row: SqlRow): StoredLink {
  const link: StoredLink = {
    kind: parseLinkKind(columnString(row, "kind")),
    embed: columnNumber(row, "embed") !== 0,
    target: columnString(row, "target"),
    line: columnNumber(row, "line"),
    span: { start: columnNumber(row, "span_start"), end: columnNumber(row, "span_end") },
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
export function createSqlKnowledgeStore(driver: SqlDriver, vaultRoot: string): KnowledgeStore {
  let transactionDepth = 0;

  const metaGet = (key: string): string | null => {
    const rows = driver.all("SELECT value FROM meta WHERE key = ?", [key]);
    const first = rows[0];
    return first === undefined ? null : columnString(first, "value");
  };

  const initSchema = (): void => {
    driver.exec(SCHEMA_DDL);
    driver.exec(`PRAGMA user_version = ${KNOWLEDGE_SCHEMA_VERSION}`);
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
      const versionRow = driver.all("PRAGMA user_version", [])[0];
      const userVersion = versionRow === undefined ? 0 : columnNumber(versionRow, "user_version");
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

  const transaction = (fn: () => void): void => {
    if (transactionDepth > 0) {
      fn(); // already atomic under the outermost transaction
      return;
    }
    driver.exec("BEGIN");
    transactionDepth = 1;
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
  };

  open();

  return {
    loadAll() {
      const docs = new Map<string, StoredDocRow>();
      for (const row of driver.all(
        "SELECT path, title, content_hash, mtime_ms, size, ino, is_private FROM files WHERE kind = 'doc' ORDER BY path",
        [],
      )) {
        const path = columnString(row, "path");
        const projection: DocProjection = {
          title: columnString(row, "title"),
          headings: [],
          links: [],
          tags: [],
          private: columnNumber(row, "is_private") !== 0,
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
      for (const row of driver.all(
        "SELECT source_path, kind, embed, target, anchor, alias, line, snippet, span_start, span_end, target_span_start, target_span_end FROM links ORDER BY source_path, ord",
        [],
      )) {
        docs.get(columnString(row, "source_path"))?.projection.links.push(parseStoredLink(row));
      }
      for (const row of driver.all("SELECT path, text FROM headings ORDER BY path, ord", [])) {
        docs.get(columnString(row, "path"))?.projection.headings.push(columnString(row, "text"));
      }
      for (const row of driver.all("SELECT path, tag FROM tags ORDER BY path, ord", [])) {
        docs.get(columnString(row, "path"))?.projection.tags.push(columnString(row, "tag"));
      }
      const others = driver
        .all("SELECT path FROM files WHERE kind = 'other' ORDER BY path", [])
        .map((row) => ({ path: columnString(row, "path") }));
      return { docs: [...docs.values()], others };
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
            `INSERT INTO links (source_path, ord, kind, embed, target, anchor, alias, line, snippet, span_start, span_end, target_span_start, target_span_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              link.span.start,
              link.span.end,
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
        const rowid = rowidOf(row.path);
        if (rowid === null) throw new Error("knowledge-store: upserted file row vanished");
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run(
          "INSERT INTO search_fts (rowid, title, headings, body, path) VALUES (?, ?, ?, ?, ?)",
          [rowid, projection.title, projection.headings.join("\n"), body, row.path],
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
