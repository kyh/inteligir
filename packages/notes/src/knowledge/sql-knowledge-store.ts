// Three guards at open — PRAGMA user_version, meta.projection_version and
// meta.vault_root — and any mismatch or malformed row resets and rebuilds: the
// db is a cache. Hydration is paged because the binding is synchronous; a
// whole-corpus read stalled 1.2s on a 50k-note vault.

import { z } from "zod";

import type { SearchResult } from "./knowledge-index";
import type { KnowledgeStore, StoredDocRow } from "./knowledge-store";
import { PROJECTION_VERSION } from "./projection";
import { parseStoredProjection } from "./projection-row";
import { searchExcerpt } from "./search-excerpt";
import type { SearchHit } from "./search-index";
import { planSearchQuery, stemText, type SearchQueryPlan } from "./search-query";
import { splitLines } from "./source-lines";
import type { DocText } from "./text-matches";

// bump on any DDL change; a mismatch wipes and rebuilds
export const KNOWLEDGE_SCHEMA_VERSION = 11;

type SqlValue = null | number | string;

export type SqlRow = Record<string, SqlValue>;

export type SqlDriver = {
  exec(sql: string): void;
  run(sql: string, params: readonly SqlValue[]): void;
  all(sql: string, params: readonly SqlValue[]): SqlRow[];
  /** destroy the database entirely and reopen empty */
  reset(): void;
  close(): void;
};

type HydrationPage =
  | { kind: "docs"; docs: StoredDocRow[] }
  | { kind: "others"; others: { path: string }[] }
  | { kind: "done" };

// reads through the live db: abandon the cursor after a write, `nuke()` or `dispose()`
type HydrationCursor = {
  next(): HydrationPage;
};

export type SqlKnowledgeStore = KnowledgeStore & {
  hydrate(pageDocs: number): HydrationCursor;
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
  projection TEXT
);
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, headings, body,
  title_stems, heading_stems, body_stems,
  path UNINDEXED,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
);
`;

// the weights mirror search-index's title/heading/body, once for the literal columns and
// once for the stem shadow; both reads share this so they differ in what they select, never in rank
const BM25_RANK = "bm25(search_fts, 10.0, 4.0, 1.0, 10.0, 4.0, 1.0) AS rank";

// the body comes back whole and search-excerpt.ts cuts it: fts5's snippet() cannot see a stem-only hit
const SEARCH_SQL = `
SELECT path, title, body, ${BM25_RANK}
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
SELECT path, content_hash, projection
FROM files WHERE kind = 'doc' AND path > ? ORDER BY path LIMIT ?
`;
const OTHER_PAGE_SQL = `
SELECT path FROM files WHERE kind = 'other' AND path > ? ORDER BY path LIMIT ?
`;

const PATH_START = "";

const HYDRATION_DRAIN_PAGE_DOCS = 1000;

const LITERAL_COLUMNS = "{title headings body}";
const STEM_COLUMNS = "{title_stems heading_stems body_stems}";

// every term is quoted because fts5 reads AND/OR/NOT/NEAR, `*`, `^`, `:`, `-` and parens as
// syntax, and the tokenizer cannot emit a `"`, so nothing can close the quote. literal arm OR
// stem arm is the exact tier (search-index.ts has the porter example), and each term is
// parenthesized so its inner OR cannot bind against the joining AND
function renderFtsMatch(plan: SearchQueryPlan): string {
  return plan.terms
    .map(
      (term) =>
        `(${LITERAL_COLUMNS}: "${term.token}"${term.prefix ? " *" : ""}` +
        ` OR ${STEM_COLUMNS}: "${term.stem}")`,
    )
    .join(plan.match === "all" ? " AND " : " OR ");
}

function columnNumber(row: SqlRow, key: string): number {
  const value = z.number().safeParse(row[key]);
  if (value.success) return value.data;
  throw new Error(`knowledge-store: column ${key} is not a number`);
}

function columnString(row: SqlRow, key: string): string {
  const value = z.string().safeParse(row[key]);
  if (value.success) return value.data;
  throw new Error(`knowledge-store: column ${key} is not text`);
}

// bm25 is lower-is-better; flip to match the pure index's direction
function rankScore(row: SqlRow): number {
  return -columnNumber(row, "rank");
}

// the literal scan's candidates: LIKE folds ascii case only, which is why text-matches hands
// over a prefilter for ascii needles alone and asks for every doc otherwise
const DOC_TEXTS_SQL = "SELECT path, title, body FROM search_fts ORDER BY path";
const DOC_TEXTS_LIKE_SQL =
  "SELECT path, title, body FROM search_fts WHERE body LIKE ? ESCAPE '\\' ORDER BY path";

function likePattern(prefilter: string): string {
  return `%${prefilter.replace(/[\\%_]/gu, "\\$&")}%`;
}

export function createSqlKnowledgeStore(driver: SqlDriver, vaultRoot: string): SqlKnowledgeStore {
  let transactionDepth = 0;

  const metaGet = (key: string): string | null => {
    const rows = driver.all("SELECT value FROM meta WHERE key = ?", [key]);
    const first = rows[0];
    return first === undefined ? null : columnString(first, "value");
  };

  const readSchemaVersion = (): number => {
    const row = driver.all("PRAGMA user_version", [])[0];
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

  const open = (): void => {
    try {
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
      // not our current cache: wipe and rebuild
      console.warn("[knowledge-store] discarding index db (will rebuild):", messageOf(err));
      driver.reset();
      initSchema();
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

  const answerPlan = (
    sql: string,
    query: string,
    limit: number,
  ): { plan: SearchQueryPlan; rows: SqlRow[] } | null => {
    for (const plan of planSearchQuery(query)) {
      const rows = driver.all(sql, [renderFtsMatch(plan), limit]);
      if (rows.length > 0) return { plan, rows };
    }
    return null;
  };

  const rowidOf = (path: string): number | null => {
    const row = driver.all("SELECT rowid FROM files WHERE path = ?", [path])[0];
    return row === undefined ? null : columnNumber(row, "rowid");
  };

  const readDocPage = (after: string, limit: number): StoredDocRow[] =>
    driver.all(DOC_PAGE_SQL, [after, limit]).map((row) => ({
      path: columnString(row, "path"),
      contentHash: columnString(row, "content_hash"),
      projection: parseStoredProjection(columnString(row, "projection")),
    }));

  const readOtherPage = (after: string, limit: number): { path: string }[] =>
    driver.all(OTHER_PAGE_SQL, [after, limit]).map((row) => ({ path: columnString(row, "path") }));

  // a short page ends its phase immediately, so the corpus is never re-queried just to learn it ran out
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
          `INSERT INTO files (path, kind, content_hash, projection)
           VALUES (?, 'doc', ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             kind = 'doc', content_hash = excluded.content_hash,
             projection = excluded.projection`,
          [row.path, row.contentHash, JSON.stringify(projection)],
        );
        const rowid = rowidOf(row.path);
        if (rowid === null) throw new Error("knowledge-store: upserted file row vanished");
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        const headings = [...projection.headings, ...projection.aliases].join("\n");
        driver.run(
          // aliases ride the headings column as a ranking boost; knowledge-index's setDoc must match
          `INSERT INTO search_fts
             (rowid, title, headings, body, title_stems, heading_stems, body_stems, path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rowid,
            projection.title,
            headings,
            body,
            stemText(projection.title),
            stemText(headings),
            stemText(body),
            row.path,
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
             kind = 'other', content_hash = NULL, projection = NULL`,
          [path],
        );
      });
    },

    remove(path) {
      transaction(() => {
        const rowid = rowidOf(path);
        if (rowid === null) return;
        driver.run("DELETE FROM search_fts WHERE rowid = ?", [rowid]);
        driver.run("DELETE FROM files WHERE path = ?", [path]);
      });
    },

    clear() {
      transaction(() => {
        driver.run("DELETE FROM search_fts", []);
        driver.run("DELETE FROM files", []);
      });
    },

    search(query, limit): SearchResult[] {
      if (limit <= 0) return [];
      const answered = answerPlan(SEARCH_SQL, query, limit);
      if (answered === null) return [];
      return answered.rows.map((row) => {
        const title = columnString(row, "title");
        const snippet = searchExcerpt(splitLines(columnString(row, "body")), answered.plan.terms);
        return {
          path: columnString(row, "path"),
          title,
          snippet: snippet === "" ? title : snippet,
          score: rankScore(row),
        };
      });
    },

    searchRanked(query, limit): SearchHit[] {
      if (limit <= 0) return [];
      const answered = answerPlan(RANK_SQL, query, limit);
      if (answered === null) return [];
      return answered.rows.map((row) => ({
        path: columnString(row, "path"),
        score: rankScore(row),
      }));
    },

    docTexts(prefilter): DocText[] {
      const rows =
        prefilter === null
          ? driver.all(DOC_TEXTS_SQL, [])
          : driver.all(DOC_TEXTS_LIKE_SQL, [likePattern(prefilter)]);
      return rows.map((row) => ({
        path: columnString(row, "path"),
        title: columnString(row, "title"),
        body: columnString(row, "body"),
      }));
    },

    transaction,

    nuke() {
      driver.reset();
      initSchema();
    },

    dispose() {
      driver.close();
    },
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
