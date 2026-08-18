// ---------------------------------------------------------------------------
// The SQL KnowledgeStore — schema, guards, and queries written ONCE over an
// injected SqlDriver, so the wasm binding the workspace's suites drive and the
// host's Durable Object storage run the IDENTICAL migrations and bm25 search.
// Only the
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
// Search: FTS5 over (title, headings, body) plus a STEM SHADOW of the same
// three, unicode61 with `_` kept as a token char and diacritics folded, to
// match core tokenize() exactly.
// WHICH tokens a query asks for, and which of them are stems, is
// search-query.ts's answer — shared with the pure SearchIndex so the two
// engines cannot drift — and this file only renders it as a MATCH expression,
// ranked by weighted bm25 mirroring the pure index's TITLE/HEADING/BODY
// weights (10/4/1), the shadow carrying the same three weights so a stemmed
// title hit still outranks a stemmed body hit.
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
import type { KnowledgeStore, StoredDocRow } from "./knowledge-store";
import { PROJECTION_VERSION } from "./projection";
import { parseStoredProjection } from "./projection-row";
import { searchExcerpt } from "./search-excerpt";
import type { SearchHit } from "./search-index";
import { planSearchQuery, stemText, type SearchQueryPlan } from "./search-query";
import { splitLines } from "./source-lines";

/** Bump on any DDL change — an older/newer file is wiped and rebuilt. */
export const KNOWLEDGE_SCHEMA_VERSION = 11;

/** What the store binds/reads. SQLite NULL/REAL/INTEGER/TEXT — no blobs. */
type SqlValue = null | number | string;

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
type HydrationPage =
  | { kind: "docs"; docs: StoredDocRow[] }
  | { kind: "others"; others: { path: string }[] }
  | { kind: "done" };

/** A resumable read of everything persisted. `next()` is the only synchronous
 * unit of work — call it until it answers `done`, yielding in between. A
 * cursor reads through the live DB, so it must be abandoned (not resumed)
 * after a write, a `nuke()`, or a `dispose()`. */
type HydrationCursor = {
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

// `files` carries identity, the content hash and the whole DocProjection as
// ONE json column; `search_fts` holds the only copy of doc bodies.
//
// The projection is stored rather than shredded because nothing queries its
// parts: link, tag and name RESOLUTION all happen in the in-memory
// LinkGraphIndex, so five FK-cascaded child tables only ever served
// hydration's own sweeps — and Durable Object SQLite bills rows WRITTEN, so a
// doc with 30 links and 8 tasks cost 56 billed writes where it now costs one.
// Sibling workstreams extend by adding a projection field and bumping
// PROJECTION_VERSION; the wipe-and-rebuild guard IS the migration.
//
// `files.path` is the PK, so paged hydration is an index range scan.
//
// `remove_diacritics` is STATED rather than defaulted, and it is half of a
// contract: core's tokenize() folds the same way (NFD, nonspacing marks
// dropped), so the two engines index the same tokens. A default that moved
// under us would split them silently, which is exactly the class of bug the
// stem shadow made reachable.
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

// bm25() returns lower-is-better (negative) ranks; weights mirror the pure
// SearchIndex's TITLE_WEIGHT/HEADING_WEIGHT/BODY_WEIGHT so a title hit beats a
// body-only hit, once for the literal columns and once for their stem shadow.
// Path tiebreak keeps ordering deterministic. Both reads below name this one
// expression, so the two can differ in what they SELECT and never in how they
// rank.
const BM25_RANK = "bm25(search_fts, 10.0, 4.0, 1.0, 10.0, 4.0, 1.0) AS rank";

// The BODY comes back whole and the excerpt is cut in JS (search-excerpt.ts).
// FTS5's `snippet()` cuts one column from THAT column's match offsets, and a
// stem-only hit matches `body_stems` — offsets FTS5 will not carry across to
// column 2 — so it answered with the note's opening words under a hit the
// reader could not see. Cutting here also puts both engines on one snippet
// policy, where `snippet()` and the pure index's first-matching-line had
// quietly been two. The cost is the body of each RETURNED row (LIMIT bounds
// it), which SQLite reads to satisfy the query either way.
const SEARCH_SQL = `
SELECT path, title, body, ${BM25_RANK}
FROM search_fts
WHERE search_fts MATCH ?
ORDER BY rank, path
LIMIT ?
`;

// The same ranking with NO body column: `searchRanked` answers the
// related-notes lexical probe, which sums scores and renders nothing, so
// every byte of every hit's body would be read and dropped — and that probe
// runs once per title token, not once per user keystroke.
const RANK_SQL = `
SELECT path, ${BM25_RANK}
FROM search_fts
WHERE search_fts MATCH ?
ORDER BY rank, path
LIMIT ?
`;

// Hydration reads. Both `files` pages are keyset-paginated (`path > ?` against
// the PK index) rather than OFFSET-paginated, so page N costs the same as
// page 0.
const DOC_PAGE_SQL = `
SELECT path, content_hash, projection
FROM files WHERE kind = 'doc' AND path > ? ORDER BY path LIMIT ?
`;
const OTHER_PAGE_SQL = `
SELECT path FROM files WHERE kind = 'other' AND path > ? ORDER BY path LIMIT ?
`;

/** Keyset start: every vault path is non-empty, so "" precedes all of them. */
const PATH_START = "";

/** Page size `loadAll()` drains at. Only a batching detail — the whole result
 * is materialized either way — sized so the intermediate arrays stay small
 * without paying a per-page query round-trip for every few rows. */
const HYDRATION_DRAIN_PAGE_DOCS = 1000;

/** The literal text, and the shadow holding its stems. */
const LITERAL_COLUMNS = "{title headings body}";
const STEM_COLUMNS = "{title_stems heading_stems body_stems}";

/** One plan (search-query.ts) rendered as an FTS5 MATCH expression.
 *
 * Every term is QUOTED, and that is load-bearing rather than cosmetic: FTS5
 * reads `AND`/`OR`/`NOT`/`NEAR`, `*`, `^`, `:`, `-` and parentheses as syntax,
 * so a user typing "near miss" or "c++" would otherwise be composing the
 * expression rather than searching for it. A quoted string is a phrase, never
 * an operator — and core's tokenizer cannot emit a `"` in the first place, so
 * nothing can close the quote either. The column filters are this file's own
 * text and name columns that exist, so they carry nothing a caller wrote.
 *
 * EVERY term asks both halves — its stem over the shadow, and the literal word
 * itself over the text — and that OR is THE EXACT TIER rather than a
 * belt-and-braces duplicate. Matching the shadow alone would let an
 * over-stemmed collision beat a real hit: Porter maps `busy` and `business`
 * both to `busi` and `organ` and `organization` both to `organ`, so a note
 * TITLED "Busy" (weight 10) would outrank a note whose body actually says
 * `business` (weight 1) with nothing to separate them. A doc holding the word
 * itself satisfies both arms, and bm25 sums the columns each arm matched, so
 * it scores about twice a doc that only shares the stem. The literal arm adds
 * no DOCUMENTS — anything holding the token already carries its stem in the
 * shadow — so this changes ranking only, never the hit set.
 *
 * The term still being TYPED takes the same tier with a prefix on its literal
 * arm, because a prefix run against stems stops matching the moment it reaches
 * the suffix (stemText states the measurement) while the stem arm is what lets
 * a one-word query — nothing BUT this term — reach `dentist` from `dentists`.
 *
 * Each term is parenthesized so its inner OR cannot bind against the AND
 * joining the terms.
 *
 * The pure SearchIndex implements the same tier by SUMMING the two
 * contributions; the two engines are held to it by the store's own suite. */
function renderFtsMatch(plan: SearchQueryPlan): string {
  return plan.terms
    .map(
      (term) =>
        `(${LITERAL_COLUMNS}: "${term.token}"${term.prefix ? " *" : ""}` +
        ` OR ${STEM_COLUMNS}: "${term.stem}")`,
    )
    .join(plan.match === "all" ? " AND " : " OR ");
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

/** bm25() ranks lower-is-better (negative); flip so higher is better, matching
 * the pure index's score direction. */
function rankScore(row: SqlRow): number {
  return -columnNumber(row, "rank");
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

  /** The plan ladder (search-query.ts) run over ONE statement: plans are
   * ordered and a plan that matched nothing is not an answer, so the relaxed
   * plan behind it is what turns an empty box into hits. The answering plan
   * comes back with its rows — the excerpt needs the terms that matched. */
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

  /** One doc page: the `files` slice after `after`. Empty when the corpus is
   * exhausted. */
  const readDocPage = (after: string, limit: number): StoredDocRow[] =>
    driver.all(DOC_PAGE_SQL, [after, limit]).map((row) => ({
      path: columnString(row, "path"),
      contentHash: columnString(row, "content_hash"),
      projection: parseStoredProjection(columnString(row, "projection")),
    }));

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
          // Aliases ride the headings column — a ranking boost only (the alias
          // bytes already match via the body, which includes the frontmatter),
          // mirroring the pure SearchIndex composition in knowledge-index.ts.
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
        driver.run("DELETE FROM files", []); // children CASCADE
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
