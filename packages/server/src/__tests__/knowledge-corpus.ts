// ---------------------------------------------------------------------------
// The synthetic vault the knowledge cost-shape suites measure against —
// knowledge-query-perf.test.ts (incremental resolution, graph assembly, FTS
// search) and knowledge-hydration.test.ts (paged hydration). ONE corpus on
// purpose: each suite's header documents numbers taken against "the same"
// corpus, and two hand-rolled generators make that claim silently false the
// first time either is tuned.
//
// Per doc: 8 links (7 resolving inside the corpus, the 8th an embed that
// dangles; one carries a display alias and one a heading anchor), 4 headings,
// 3 tags, 1 doc alias, 3 GFM tasks, and `private` on every 17th — ~20
// persisted rows, the shape that makes resolution, the graph and hydration all
// expensive. Bodies carry "the" in every doc (a term FTS5 must rank the whole
// corpus for) and `body-<id>` in exactly one.
//
// Not a `.test.ts` file: the package's vitest include is `src/**/*.test.ts`,
// so this is a module the suites import, never a suite of its own.
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";

import type { StoredDocRow } from "@repo/notes/knowledge/knowledge-store";
import type { DocProjection, StoredLink } from "@repo/notes/knowledge/projection";
import type { SqlDriver, SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";

/** Vault path of doc `i` — zero-padded so path order is index order. */
export function docPath(i: number): string {
  return `notes/note-${String(i).padStart(6, "0")}.md`;
}

/** Doc `i`'s projection in a `total`-doc corpus. `revision` perturbs the link
 * snippets, so re-projecting a doc is a real change rather than a no-op. */
export function syntheticProjection(i: number, total: number, revision = 0): DocProjection {
  const id = String(i).padStart(6, "0");
  return {
    title: `Note ${id}`,
    headings: [`Note ${id}`, "Context", "Details", "Next steps"],
    links: Array.from({ length: 8 }, (_, k): StoredLink => {
      const target =
        k === 7
          ? `missing-${String((i * 7 + k) % 5000).padStart(6, "0")}`
          : `note-${String((i + k * 37) % total).padStart(6, "0")}`;
      return {
        kind: "wiki",
        embed: k === 7,
        target,
        line: 10 + k,
        snippet: `rev${revision}: see [[${target}]] for the rest`,
        ...(k === 0 ? { alias: "the note" } : {}),
        ...(k === 1 ? { anchor: "Details" } : {}),
      };
    }),
    tags: ["project", "meta", `bucket-${i % 50}`],
    aliases: [`alias-${id}`],
    private: i % 17 === 0,
    tasks: Array.from({ length: 3 }, (_, k) => ({
      checked: k === 0,
      text: `task ${k} of ${id}`,
      raw: `- [ ] task ${k} of ${id}`,
      line: 30 + k,
      ordinal: k,
      wikiTargets: [`2026-01-0${(k % 9) + 1}`],
    })),
  };
}

/** Doc `i`'s body: "the" appears in every doc, `body-<id>` in exactly one. */
function syntheticBody(i: number): string {
  const id = String(i).padStart(6, "0");
  return `# Note ${id}\n\nbody-${id} the quick brown fox ${"filler word the ".repeat(20)}\n`;
}

/** Doc `i`'s persisted row in a `total`-doc corpus. */
function syntheticRow(i: number, total: number): StoredDocRow {
  return {
    path: docPath(i),
    fingerprint: {
      mtimeMs: 1_700_000_000_000 + i,
      size: syntheticBody(i).length,
      ino: 5000 + i,
    },
    contentHash: `hash-${String(i).padStart(6, "0")}`,
    projection: syntheticProjection(i, total),
  };
}

/** Fill a store with `docs` synthetic docs and `others` non-doc files, in
 * transactions of 1000 — a per-doc transaction dominates the seed at corpus
 * sizes the benchmarks use. */
export function seedStore(store: SqlKnowledgeStore, docs: number, others = 0): void {
  for (let start = 0; start < docs; start += 1000) {
    store.transaction(() => {
      for (let i = start; i < Math.min(start + 1000, docs); i++) {
        store.upsertDoc(syntheticRow(i, docs), syntheticBody(i));
      }
    });
  }
  if (others === 0) return;
  store.transaction(() => {
    for (let i = 0; i < others; i++) {
      store.upsertOther(`assets/pic-${String(i).padStart(6, "0")}.png`);
    }
  });
}

/** A node:sqlite driver over an in-memory database (the production one is
 * private to sqlite-knowledge-store). `reset()` honours the port's contract —
 * destroy the instance and reopen empty — so a suite that trips the store's
 * recovery path lands on a genuinely blank database, not a half-wiped one.
 * File/WAL lifecycle is out of scope here; sqlite-knowledge-store.test.ts owns
 * that. Wrap the returned driver to instrument individual calls. */
export function memorySqlDriver(): SqlDriver {
  let db = new DatabaseSync(":memory:");
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      db.prepare(sql).run(...params);
    },
    all: (sql, params) => db.prepare(sql).all(...params),
    reset: () => {
      db.close();
      db = new DatabaseSync(":memory:");
    },
    close: () => {
      db.close();
    },
  };
}
