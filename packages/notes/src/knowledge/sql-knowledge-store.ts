// Three guards at open — PRAGMA user_version, meta.projection_version and
// meta.vault_root — and any mismatch or malformed row resets and rebuilds: the
// db is a cache. Hydration is paged because the binding is synchronous; a
// whole-corpus read stalled 1.2s on a 50k-note vault.

import { z } from "zod";

import type { DocFingerprint, KnowledgeStore, StoredDocRow } from "./knowledge-store";
import { PROJECTION_VERSION } from "./projection";
import type { DocProjection } from "./projection";
import { parseStoredProjection } from "./projection-row";
import { searchExcerpt } from "./search-excerpt";
import type { SearchHit } from "./search-index";
import { renderFtsMatch } from "./fts-match";
import { planSearchQuery, SEARCH_FIELD_WEIGHTS, TYPED_QUERY } from "./search-query";
import type { SearchQueryOptions, SearchQueryPlan, SearchResult } from "./search-query";
import type { DocText } from "./text-matches";

// bump on any DDL change; a mismatch wipes and rebuilds
export const KNOWLEDGE_SCHEMA_VERSION = 12;

type SqlValue = null | number | string;

export type SqlRow = Record<string, SqlValue>;

// the store's own database failed, or holds a row the store cannot read back. a driver throws it
// for every failure of the database, and the host rebuilds on it and nothing else: any other
// failure (a listing, the scan) would meet a rebuild the same way.
export class KnowledgeStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KnowledgeStoreError";
  }
}

/** every method throws `KnowledgeStoreError`, and only it, when the database fails */
export interface SqlDriver {
  exec: (sql: string) => void;
  run: (sql: string, params: readonly SqlValue[]) => void;
  all: (sql: string, params: readonly SqlValue[]) => SqlRow[];
  /** destroy the database entirely and reopen empty */
  reset: () => void;
  close: () => void;
}

type HydrationPage =
  | { kind: "docs"; docs: StoredDocRow[] }
  | { kind: "others"; others: StoredOtherRow[] }
  | { kind: "done" };

// `unprojectableHash` names the bytes of a doc whose projection threw, so a restart does not
// project them again; a build whose projection could now take them bumps PROJECTION_VERSION.
export interface StoredOtherRow {
  path: string;
  unprojectableHash: string | null;
}

// reads through the live db: abandon the cursor after a write, `nuke()` or `dispose()`
interface HydrationCursor {
  next: () => HydrationPage;
}

// what open found: a cache it reuses, none, or one it discarded and why. The caller logs it:
// this package names no console.
export type StoreOpenVerdict =
  | { kind: "created" }
  | { kind: "reused" }
  | { kind: "discarded"; reason: string };

export type SqlKnowledgeStore = KnowledgeStore & {
  hydrate: (pageDocs: number) => HydrationCursor;
  readonly opened: StoreOpenVerdict;
};

// `remove_diacritics 2` is stated, not defaulted: core's tokenize() folds the same
// way, and a default that moved would split the two engines silently
const SCHEMA_DDL = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('doc', 'other')),
  content_hash TEXT,
  projection TEXT,
  size INTEGER,
  modified_ms REAL
);
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, headings, meta, body,
  title_stems, heading_stems, meta_stems, body_stems,
  path UNINDEXED,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
);
`;

// the shared field weights, once for the literal columns and once for the stem shadow; both reads
// share this so they differ in what they select, never in rank
const COLUMN_WEIGHTS = [
  SEARCH_FIELD_WEIGHTS.title,
  SEARCH_FIELD_WEIGHTS.headings,
  SEARCH_FIELD_WEIGHTS.meta,
  SEARCH_FIELD_WEIGHTS.body,
].join(", ");
const BM25_RANK = `bm25(search_fts, ${COLUMN_WEIGHTS}, ${COLUMN_WEIGHTS}) AS rank`;

// the body comes back whole and search-excerpt.ts cuts it: fts5's snippet() cannot see a stem-only
// hit. a hit on an item's properties alone is shown by them
const SEARCH_SQL = `
SELECT path, title, meta, body, ${BM25_RANK}
FROM search_fts
WHERE search_fts MATCH ?
ORDER BY rank, path
LIMIT ?
`;

// no body column: the related-notes probe renders nothing and runs once per title token
const RANK_SQL = `
SELECT path, ${BM25_RANK}
FROM search_fts
WHERE search_fts MATCH ?
ORDER BY rank, path
LIMIT ?
`;

// keyset (`path > ?` on the pk) rather than offset, so page n costs the same as page 0
const DOC_PAGE_SQL = `
SELECT path, content_hash, projection, size, modified_ms
FROM files WHERE kind = 'doc' AND path > ? ORDER BY path LIMIT ?
`;
const OTHER_PAGE_SQL = `
SELECT path, content_hash FROM files WHERE kind = 'other' AND path > ? ORDER BY path LIMIT ?
`;

const PATH_START = "";

const columnNumber = (row: SqlRow, key: string): number => {
  const value = z.number().safeParse(row[key]);
  if (value.success) {
    return value.data;
  }
  throw new KnowledgeStoreError(`knowledge-store: column ${key} is not a number`);
};

const columnString = (row: SqlRow, key: string): string => {
  const value = z.string().safeParse(row[key]);
  if (value.success) {
    return value.data;
  }
  throw new KnowledgeStoreError(`knowledge-store: column ${key} is not text`);
};

const columnNullableString = (row: SqlRow, key: string): string | null =>
  row[key] === null ? null : columnString(row, key);

// both or neither: a row written without its stat reads as one the next reconcile reads again
const fingerprintOf = (row: SqlRow): DocFingerprint | null =>
  row["size"] === null || row["modified_ms"] === null
    ? null
    : { mtimeMs: columnNumber(row, "modified_ms"), size: columnNumber(row, "size") };

// bm25 is lower-is-better; flip to match the pure index's direction
const rankScore = (row: SqlRow): number => -columnNumber(row, "rank");

// the literal scan's candidates: LIKE folds ascii case only, which is why text-matches hands
// over prefilters for ascii needles alone and asks for every doc otherwise
const DOC_TEXTS_SQL = "SELECT path, title, body FROM search_fts ORDER BY path";
const docTextsLikeSql = (count: number): string =>
  `SELECT path, title, body FROM search_fts WHERE ${Array.from(
    { length: count },
    () => "body LIKE ? ESCAPE '\\'",
  ).join(" OR ")} ORDER BY path`;

const likePattern = (prefilter: string): string => `%${prefilter.replaceAll(/[\\%_]/gu, "\\$&")}%`;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const storedProjection = (json: string): DocProjection => {
  try {
    return parseStoredProjection(json);
  } catch (error) {
    throw new KnowledgeStoreError(messageOf(error), { cause: error });
  }
};

export const createSqlKnowledgeStore = (
  driver: SqlDriver,
  vaultRoot: string,
): SqlKnowledgeStore => {
  let transactionDepth = 0;

  const metaGet = (key: string): string | null => {
    const [first] = driver.all("SELECT value FROM meta WHERE key = ?", [key]);
    return first === undefined ? null : columnString(first, "value");
  };

  const readSchemaVersion = (): number => {
    const [row] = driver.all("PRAGMA user_version", []);
    return row === undefined ? 0 : columnNumber(row, "user_version");
  };

  const initSchema = (): void => {
    driver.exec(SCHEMA_DDL);
    driver.exec(`PRAGMA user_version = ${KNOWLEDGE_SCHEMA_VERSION}`);
    driver.run(
      "INSERT INTO meta (key, value) VALUES ('projection_version', ?), ('vault_root', ?)",
      [String(PROJECTION_VERSION), vaultRoot],
    );
  };

  const open = (): StoreOpenVerdict => {
    try {
      const userVersion = readSchemaVersion();
      const hasMeta =
        driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'", [])
          .length > 0;
      if (userVersion === 0 && !hasMeta) {
        initSchema();
        return { kind: "created" };
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
      return { kind: "reused" };
    } catch (error) {
      // not our current cache: wipe and rebuild
      driver.reset();
      initSchema();
      return { kind: "discarded", reason: messageOf(error) };
    }
  };

  const transaction = (fn: () => void): void => {
    if (transactionDepth > 0) {
      // already atomic under the outermost transaction
      fn();
      return;
    }
    driver.exec("BEGIN");
    transactionDepth = 1;
    try {
      fn();
      driver.exec("COMMIT");
    } catch (error) {
      try {
        driver.exec("ROLLBACK");
      } catch {
        // The transaction may already be gone (e.g. the failure closed it).
      }
      throw error;
    } finally {
      transactionDepth = 0;
    }
  };

  const answerPlan = (
    sql: string,
    query: string,
    limit: number,
    options: SearchQueryOptions,
  ): { plan: SearchQueryPlan; rows: SqlRow[] } | null => {
    for (const plan of planSearchQuery(query, options)) {
      const rows = driver.all(sql, [renderFtsMatch(plan), limit]);
      if (rows.length > 0) {
        return { plan, rows };
      }
    }
    return null;
  };

  const rowidOf = (path: string): number | null => {
    const [row] = driver.all("SELECT rowid FROM files WHERE path = ?", [path]);
    return row === undefined ? null : columnNumber(row, "rowid");
  };

  const readDocPage = (after: string, limit: number): StoredDocRow[] =>
    driver.all(DOC_PAGE_SQL, [after, limit]).map((row) => ({
      contentHash: columnString(row, "content_hash"),
      fingerprint: fingerprintOf(row),
      path: columnString(row, "path"),
      projection: storedProjection(columnString(row, "projection")),
    }));

  const readOtherPage = (after: string, limit: number): StoredOtherRow[] =>
    driver.all(OTHER_PAGE_SQL, [after, limit]).map((row) => ({
      path: columnString(row, "path"),
      unprojectableHash: columnNullableString(row, "content_hash"),
    }));

  // a short page ends its phase immediately, so the corpus is never re-queried just to learn it ran out
  type HydrationState =
    | { phase: "docs"; after: string }
    | { phase: "others"; after: string }
    | { phase: "done" };

  const hydrate = (pageDocs: number): HydrationCursor => {
    const limit = Math.max(1, Math.floor(pageDocs));
    let state: HydrationState = { after: PATH_START, phase: "docs" };
    const next = (): HydrationPage => {
      for (;;) {
        switch (state.phase) {
          case "docs": {
            const docs = readDocPage(state.after, limit);
            const last = docs.at(-1);
            state =
              last === undefined || docs.length < limit
                ? { after: PATH_START, phase: "others" }
                : { after: last.path, phase: "docs" };
            // no docs left — fall into others
            if (last === undefined) {
              continue;
            }
            return { docs, kind: "docs" };
          }
          case "others": {
            const others = readOtherPage(state.after, limit);
            const last = others.at(-1);
            state =
              last === undefined || others.length < limit
                ? { phase: "done" }
                : { after: last.path, phase: "others" };
            if (last === undefined) {
              return { kind: "done" };
            }
            return { kind: "others", others };
          }
          case "done": {
            return { kind: "done" };
          }
          // no default
        }
      }
    };
    return { next };
  };

  const opened = open();

  return {
    dispose() {
      driver.close();
    },

    docTexts(prefilters): DocText[] {
      if (prefilters?.length === 0) {
        return [];
      }
      const rows =
        prefilters === null
          ? driver.all(DOC_TEXTS_SQL, [])
          : driver.all(docTextsLikeSql(prefilters.length), prefilters.map(likePattern));
      return rows.map((row) => ({
        body: columnString(row, "body"),
        path: columnString(row, "path"),
        title: columnString(row, "title"),
      }));
    },

    hydrate,

    nuke() {
      driver.reset();
      initSchema();
    },

    opened,

    remove(path) {
      transaction(() => {
        const rowid = rowidOf(path);
        if (rowid === null) {
          return;
        }
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run("DELETE FROM files WHERE path = ?", [path]);
      });
    },

    search(query, limit): SearchResult[] {
      if (limit <= 0) {
        return [];
      }
      const answered = answerPlan(SEARCH_SQL, query, limit, TYPED_QUERY);
      if (answered === null) {
        return [];
      }
      return answered.rows.map((row) => {
        const title = columnString(row, "title");
        const { terms } = answered.plan;
        const snippet =
          searchExcerpt(columnString(row, "body"), terms) ||
          searchExcerpt(columnString(row, "meta"), terms);
        return {
          path: columnString(row, "path"),
          score: rankScore(row),
          snippet: snippet === "" ? title : snippet,
          title,
        };
      });
    },

    searchRanked(query, limit, options = TYPED_QUERY): SearchHit[] {
      if (limit <= 0) {
        return [];
      }
      const answered = answerPlan(RANK_SQL, query, limit, options);
      if (answered === null) {
        return [];
      }
      return answered.rows.map((row) => ({
        path: columnString(row, "path"),
        score: rankScore(row),
      }));
    },

    setFingerprint(path, fingerprint) {
      driver.run("UPDATE files SET size = ?, modified_ms = ? WHERE path = ? AND kind = 'doc'", [
        fingerprint.size,
        fingerprint.mtimeMs,
        path,
      ]);
    },

    transaction,

    upsertDoc(row, search) {
      transaction(() => {
        driver.run(
          `INSERT INTO files (path, kind, content_hash, projection, size, modified_ms)
           VALUES (?, 'doc', ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             kind = 'doc', content_hash = excluded.content_hash,
             projection = excluded.projection, size = excluded.size,
             modified_ms = excluded.modified_ms`,
          [
            row.path,
            row.contentHash,
            JSON.stringify(row.projection),
            row.fingerprint?.size ?? null,
            row.fingerprint?.mtimeMs ?? null,
          ],
        );
        const rowid = rowidOf(row.path);
        if (rowid === null) {
          throw new KnowledgeStoreError("knowledge-store: upserted file row vanished");
        }
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run(
          `INSERT INTO search_fts
             (rowid, title, headings, meta, body, title_stems, heading_stems, meta_stems,
              body_stems, path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rowid,
            search.title,
            search.headings,
            search.meta,
            search.body,
            search.titleStems,
            search.headingStems,
            search.metaStems,
            search.bodyStems,
            row.path,
          ],
        );
      });
    },

    upsertOther(path, unprojectableHash) {
      transaction(() => {
        const priorRowid = rowidOf(path);
        if (priorRowid !== null) {
          driver.run("DELETE FROM search_fts WHERE rowid = ?", [priorRowid]);
        }
        driver.run(
          `INSERT INTO files (path, kind, content_hash) VALUES (?, 'other', ?)
           ON CONFLICT(path) DO UPDATE SET
             kind = 'other', content_hash = excluded.content_hash, projection = NULL,
             size = NULL, modified_ms = NULL`,
          [path, unprojectableHash ?? null],
        );
      });
    },
  };
};
