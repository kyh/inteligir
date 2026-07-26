// ---------------------------------------------------------------------------
// Paged hydration — the property under test is COST SHAPE, not speed.
//
// node:sqlite is synchronous on every platform, so a whole-corpus hydration
// read is an uninterruptible stall on whichever thread calls it. The store
// hands back a keyset cursor, and the invariant that matters is that ONE
// synchronous call costs a page, never a corpus: the tests below quadruple the
// corpus and assert the largest single `driver.all()` result does not grow.
// That is machine-independent, unlike a millisecond ceiling (this repo's perf
// convention — see knowledge-perf-oracle.test.ts, "not timing tests").
//
// Wall-clock numbers, MacBook / Node 24, over the shared synthetic corpus
// (knowledge-corpus.ts — ≈20 persisted rows/doc), measured by the `bench` case
// below (page size = the manager's 500):
//
//                    worst SINGLE call     whole hydration
//   50k  monolithic        1198 ms             1202 ms
//        paged (100 pages)   16 ms              851 ms
//   10k  monolithic          224 ms              225 ms
//        paged (20 pages)     17 ms              184 ms
//
// Paging is not a tax: the keyset ranges hit the child PKs, so the total is
// lower too. End to end, KnowledgeManager's first query against a 50k-doc
// persisted projection answers in 36.9 ms — 1500 docs immediately, the rest
// streaming in on the pass queue — where a monolithic read stalls >1.2 s
// before answering anything.
//
// Set KNOWLEDGE_BENCH_DOCS=50000 to reproduce the big row (default 10k).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { StoredDocRow } from "@repo/notes/knowledge/knowledge-store";
import {
  createSqlKnowledgeStore,
  type HydrationPage,
  type SqlDriver,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";

import { KnowledgeManager } from "../knowledge/knowledge-manager";
import { createSqliteKnowledgeStore } from "../knowledge/sqlite-knowledge-store";
import { memorySqlDriver, seedStore } from "./knowledge-corpus";
import { VaultManager } from "@repo/vault/vault";

const ROOT = "/test/vault";
const BENCH_DOCS = Number(process.env.KNOWLEDGE_BENCH_DOCS ?? 10_000);

let tmp: string;
let closers: (() => void)[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-hydration-"));
  closers = [];
});

afterEach(() => {
  for (const close of closers) close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- An instrumented driver: every read's row count is recorded ---------------

type CountingDriver = SqlDriver & {
  /** Rows returned by the single largest `all()` since the last `resetPeak`. */
  peakRows: () => number;
  /** Zero the instrumentation. Distinct from the driver's own `reset`, which
   * destroys the database — shadowing that would silently disarm the store's
   * recovery path. */
  resetPeak: () => void;
};

/** The shared in-memory driver wrapped in read instrumentation. */
function countingDriver(): CountingDriver {
  const base = memorySqlDriver();
  let peak = 0;
  return {
    ...base,
    all: (sql, params) => {
      const rows = base.all(sql, params);
      peak = Math.max(peak, rows.length);
      return rows;
    },
    resetPeak: () => {
      peak = 0;
    },
    peakRows: () => peak,
  };
}

function drain(store: SqlKnowledgeStore, pageDocs: number): HydrationPage[] {
  const cursor = store.hydrate(pageDocs);
  const pages: HydrationPage[] = [];
  for (let guard = 0; guard < 100_000; guard++) {
    const page = cursor.next();
    pages.push(page);
    if (page.kind === "done") return pages;
  }
  throw new Error("hydration cursor never finished");
}

function flatten(pages: HydrationPage[]): { docs: StoredDocRow[]; others: { path: string }[] } {
  const docs: StoredDocRow[] = [];
  const others: { path: string }[] = [];
  for (const page of pages) {
    if (page.kind === "docs") docs.push(...page.docs);
    if (page.kind === "others") others.push(...page.others);
  }
  return { docs, others };
}

// ---- Cursor semantics -----------------------------------------------------------

describe("hydration cursor", () => {
  it("replays loadAll() exactly, at every page size, docs before others", () => {
    const driver = countingDriver();
    closers.push(driver.close);
    const store = createSqlKnowledgeStore(driver, ROOT);
    seedStore(store, 25, 7);
    const oneShot = store.loadAll();
    expect(oneShot.docs).toHaveLength(25);
    expect(oneShot.others).toHaveLength(7);

    // 1 = one page per row; 5 = exact multiple (the boundary where a full page
    // is followed by an empty one); 7 = ragged; 25 = the whole doc phase in a
    // single page; 999 = larger than the corpus.
    for (const pageDocs of [1, 5, 7, 25, 999]) {
      const pages = drain(store, pageDocs);
      expect(flatten(pages)).toEqual(oneShot);
      // Ordering: every docs page precedes every others page, and the final
      // page is always `done`.
      const kinds = pages.map((p) => p.kind);
      expect(kinds).toEqual(kinds.toSorted(byPhase));
      expect(kinds[kinds.length - 1]).toBe("done");
      for (const page of pages) {
        if (page.kind === "docs") expect(page.docs.length).toBeLessThanOrEqual(pageDocs);
        if (page.kind === "others") expect(page.others.length).toBeLessThanOrEqual(pageDocs);
      }
    }
  });

  it("is inert on an empty corpus", () => {
    const driver = countingDriver();
    closers.push(driver.close);
    const store = createSqlKnowledgeStore(driver, ROOT);
    expect(drain(store, 10)).toEqual([{ kind: "done" }]);
    expect(store.loadAll()).toEqual({ docs: [], others: [] });
  });

  it("keeps the largest single read bounded by the page, not the corpus", () => {
    // THE invariant. Quadruple the corpus: a monolithic read's biggest
    // call quadruples with it; a paged read's does not move at all.
    const peaks = new Map<number, { paged: number; monolithic: number }>();
    for (const docs of [500, 2000]) {
      const driver = countingDriver();
      closers.push(driver.close);
      const store = createSqlKnowledgeStore(driver, ROOT);
      seedStore(store, docs, docs);
      driver.resetPeak();
      drain(store, 100);
      const paged = driver.peakRows();
      // A monolithic read, as an oracle: one unbounded sweep per child table.
      driver.resetPeak();
      driver.all("SELECT source_path, target FROM links ORDER BY source_path, ord", []);
      peaks.set(docs, { paged, monolithic: driver.peakRows() });
    }
    const small = peaks.get(500);
    const large = peaks.get(2000);
    if (small === undefined || large === undefined) throw new Error("missing measurement");
    expect(large.paged).toBe(small.paged); // 100 docs × 8 links = 800 either way
    expect(large.monolithic).toBe(small.monolithic * 4); // 4k vs 16k rows
    expect(large.paged).toBeLessThan(large.monolithic / 4);
  });
});

// ---- Manager-level: progressive hydration ----------------------------------------

/** Wrap a store so hydration pages are small AND slow, forcing the manager's
 * synchronous budget to expire mid-corpus — the large-vault regime, without
 * building a large vault. */
function slowHydration(
  store: SqlKnowledgeStore,
  pageDocs: number,
  spinMs: number,
): SqlKnowledgeStore {
  return {
    ...store,
    hydrate: () => {
      const cursor = store.hydrate(pageDocs);
      return {
        next: () => {
          const until = Date.now() + spinMs;
          while (Date.now() < until) {
            /* burn the budget the way a real 500-doc page would */
          }
          return cursor.next();
        },
      };
    },
  };
}

describe("KnowledgeManager hydration", () => {
  it("answers from a partial graph while the rest streams in, and re-projects nothing", async () => {
    const root = path.join(tmp, "vault");
    const dbPath = path.join(tmp, "index.sqlite");
    const vault = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: root,
      manageAgentLink: false,
    });
    closers.push(() => vault.close());
    vault.ensureReady();
    for (let i = 0; i < 6; i++) vault.writeText(`note-${i}.md`, `# Note ${i}\n\n[[note-0]]\n`);

    // First run: build the persisted projection the normal way.
    let upserts = 0;
    const open = (r: string, slow: boolean): SqlKnowledgeStore => {
      const store = createSqliteKnowledgeStore(dbPath, r);
      const counted: SqlKnowledgeStore = {
        ...store,
        upsertDoc: (row, body) => {
          upserts++;
          store.upsertDoc(row, body);
        },
      };
      return slow ? slowHydration(counted, 2, 20) : counted;
    };
    const first = new KnowledgeManager(
      () => vault,
      () => {},
      (r) => open(r, false),
    );
    await first.refresh();
    expect(upserts).toBe(6);
    first.dispose();

    // Second run, large-vault regime: 2 docs per page at 20ms a page, so the
    // 25ms synchronous budget covers the first page or two and the pass
    // finishes the rest.
    upserts = 0;
    let updates = 0;
    const second = new KnowledgeManager(
      () => vault,
      () => updates++,
      (r) => open(r, true),
    );
    closers.push(() => second.dispose());
    const early = second.wikiTargets().length; // triggers the budgeted bind
    expect(early).toBeGreaterThan(0); // partial answers, not an empty index
    expect(early).toBeLessThan(6); // ...and genuinely partial
    await second.refreshDone();
    // Converged: the whole corpus is in the mirror, hydrated (not re-parsed).
    expect(
      second
        .wikiTargets()
        .map((t) => t.path)
        .toSorted(),
    ).toEqual(Array.from({ length: 6 }, (_, i) => `note-${i}.md`));
    expect(second.backlinks("note-0.md")).toHaveLength(6);
    expect(upserts).toBe(0);
    expect(updates).toBeGreaterThan(0); // the graph grew — the UI was told
  });
});

// ---- The documented benchmark ------------------------------------------------------

/** Drive a whole hydration, reporting how long it took in total and how long
 * its single worst synchronous call took. A page size at or above the corpus
 * reproduces the monolithic shape exactly — same SQL, same parsing, one
 * call. */
function timeHydration(
  store: SqlKnowledgeStore,
  pageDocs: number,
): { totalMs: number; worstCallMs: number; pages: number; docs: number } {
  const cursor = store.hydrate(pageDocs);
  let pages = 0;
  let docs = 0;
  let worstCallMs = 0;
  const start = performance.now();
  for (;;) {
    const callStart = performance.now();
    const page = cursor.next();
    worstCallMs = Math.max(worstCallMs, performance.now() - callStart);
    if (page.kind === "done") break;
    if (page.kind === "docs") docs += page.docs.length;
    pages++;
  }
  return { totalMs: performance.now() - start, worstCallMs, pages, docs };
}

// OPT-IN, and it asserts nothing about wall-clock. A timing assertion here
// compares two measurements taken seconds apart on a box running 13 other
// workspaces' suites in parallel; a GC pause or a scheduler preemption inside
// the paged run flips any ratio you pick, so the gate goes red for a machine
// hiccup rather than a regression. The property that must not regress — the
// worst call reads ONE PAGE of rows, not the whole corpus — is a ROW COUNT and
// is asserted deterministically above. This block exists to print the numbers
// on demand:  KNOWLEDGE_BENCH_DOCS=50000 pnpm --filter @repo/server test
describe.skipIf(process.env["KNOWLEDGE_BENCH_DOCS"] === undefined)("hydration benchmark", () => {
  it(`reports hydration cost at ${BENCH_DOCS} docs`, () => {
    const store = createSqliteKnowledgeStore(path.join(tmp, "bench.sqlite"), ROOT);
    closers.push(() => store.dispose());
    const buildStart = performance.now();
    seedStore(store, BENCH_DOCS);
    const buildMs = performance.now() - buildStart;

    // The monolithic baseline: one page the size of the corpus. Against it,
    // the manager's real page size.
    const before = timeHydration(store, BENCH_DOCS);
    const after = timeHydration(store, 500);

    console.log(
      `[hydration @ ${BENCH_DOCS} docs] build=${buildMs.toFixed(0)}ms | ` +
        `monolithic: total=${before.totalMs.toFixed(0)}ms worst-call=${before.worstCallMs.toFixed(0)}ms | ` +
        `paged(500): total=${after.totalMs.toFixed(0)}ms pages=${after.pages} ` +
        `worst-call=${after.worstCallMs.toFixed(1)}ms`,
    );
    expect(before.docs).toBe(BENCH_DOCS);
    expect(after.docs).toBe(BENCH_DOCS);
    expect(after.pages).toBeGreaterThan(1); // paged, not one unbroken read
  }, 600_000);
});

/** Sort key pinning the cursor's phase order: docs, then others, then done. */
function byPhase(a: HydrationPage["kind"], b: HydrationPage["kind"]): number {
  const order = { docs: 0, others: 1, done: 2 };
  return order[a] - order[b];
}
