// ---------------------------------------------------------------------------
// The vault crawl — the property under test is COST SHAPE, not speed.
//
// The crawl is on-demand by design (vault liveness — CLAUDE.md § Decisions),
// so its whole cost lands on the host's only thread at every refresh trigger.
// Two things keep that bounded, and both are asserted here as syscall counts
// and event-loop turns rather than milliseconds (this repo's perf convention —
// see packages/server/src/__tests__/knowledge-hydration.test.ts):
//
//   1. The walk NEVER stats. list()/listAllPaths() answer off Dirents alone, so
//      the syscall count of a listing is one readdir per directory — nothing
//      per file. Stats are filled in lazily and memoized on the snapshot, so
//      the consumers that need them (knowledge reconcile, the sync hash cache)
//      pay one stat per file BETWEEN them, not one each.
//   2. The stat sweep behind listWithStats() runs in slices with event-loop
//      yields, so no single synchronous step grows with the vault.
//
// Wall-clock numbers, MacBook / Node 24, 50,000 files in 500 folders, warm OS
// page cache, measured by the `bench` case below against its own oracle:
//
//                                total     longest main-thread block
//   eager walk+stat (oracle)     369 ms            369 ms
//   list()  (walk only)           58 ms             58 ms
//   listWithStats() (15 slices)  284 ms             56 ms
//
// The oracle is the shape one walk-plus-stat pass has, and more than half of it
// is per-entry path.join/path.relative math rather than the filesystem: the
// readdir syscalls for all 50,000 files come to ~40 ms on their own.
//
// Set VAULT_BENCH_FILES=50000 to reproduce.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VaultManager } from "../vault";

const BENCH_FILES = Number(process.env["VAULT_BENCH_FILES"] ?? 0);

let tmp: string;
let root: string;
let settingsPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-crawl-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function newManager(): VaultManager {
  return new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
}

/** Fill the vault with `files` docs spread over `folders` subdirectories. */
function seed(files: number, folders: number): void {
  fs.mkdirSync(root, { recursive: true });
  const perFolder = Math.ceil(files / folders);
  for (let d = 0; d < folders; d++) {
    const dir = path.join(root, `folder-${String(d).padStart(4, "0")}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < perFolder && d * perFolder + f < files; f++) {
      fs.writeFileSync(path.join(dir, `note-${String(f).padStart(4, "0")}.md`), "# Note\n");
    }
  }
}

/** Count `fs.statSync` calls made while `run` executes. */
function countStats<T>(run: () => T): { result: T; stats: number } {
  const real = fs.statSync.bind(fs);
  let stats = 0;
  const spy = vi.spyOn(fs, "statSync").mockImplementation((target, options) => {
    stats++;
    return real(target, options);
  });
  try {
    return { result: run(), stats };
  } finally {
    spy.mockRestore();
  }
}

/** Watch the event loop: how many turns it got, and the longest stretch it was
 * denied one (i.e. the longest synchronous block on this thread). */
function watchEventLoop(): { stop: () => { turns: number; longestBlockMs: number } } {
  let turns = 0;
  let longestBlockMs = 0;
  let last = Date.now();
  let running = true;
  const tick = (): void => {
    if (!running) return;
    const now = Date.now();
    longestBlockMs = Math.max(longestBlockMs, now - last);
    last = now;
    turns++;
    setImmediate(tick);
  };
  setImmediate(tick);
  return {
    stop: () => {
      running = false;
      return { turns, longestBlockMs };
    },
  };
}

describe("vault crawl cost", () => {
  it("lists without stat-ing: one readdir per directory, nothing per file", () => {
    const mgr = newManager();
    seed(40, 4);

    // A cold crawl, then the cached one, then the sync-facing listing: none of
    // them may cost a stat per file.
    const cold = countStats(() => mgr.list());
    expect(cold.result).toHaveLength(40);
    expect(cold.stats).toBe(0);
    expect(countStats(() => mgr.list()).stats).toBe(0);
    expect(countStats(() => mgr.listAllPaths()).stats).toBe(0);
  });

  it("stats each file at most once per snapshot, shared across consumers", async () => {
    const mgr = newManager();
    seed(40, 4);
    const paths = mgr.listAllPaths();

    // The knowledge reconcile's sweep: one stat per file, no more.
    const real = fs.statSync.bind(fs);
    let stats = 0;
    const spy = vi.spyOn(fs, "statSync").mockImplementation((target, options) => {
      stats++;
      return real(target, options);
    });
    try {
      const listing = await mgr.listWithStats();
      expect(listing).toHaveLength(40);
      expect(stats).toBe(40);

      // The sync hash cache asking for the same files inside the same snapshot
      // window reuses the memo instead of sweeping again.
      stats = 0;
      for (const p of paths) expect(mgr.statFingerprint(p)).not.toBeNull();
      expect(stats).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("yields the event loop while sweeping stats, instead of blocking on the whole vault", async () => {
    const mgr = newManager();
    seed(60, 3);
    mgr.list(); // warm the walk so only the sweep is measured

    // Make each stat cost ~1ms of wall clock, so 60 files is ~60ms of sweep —
    // several times the slice budget on ANY machine (contention only makes it
    // more slices, never fewer).
    const real = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation((target, options) => {
      const until = Date.now() + 1;
      while (Date.now() < until) {
        /* burn a millisecond the way a cold-cache stat would */
      }
      return real(target, options);
    });
    const loop = watchEventLoop();
    try {
      expect(await mgr.listWithStats()).toHaveLength(60);
    } finally {
      spy.mockRestore();
    }
    // The sweep handed the loop back repeatedly rather than running to
    // completion in one uninterruptible call.
    expect(loop.stop().turns).toBeGreaterThan(1);
  });

  it("keeps the walk's relative paths identical to path.relative's", () => {
    // The walk builds each entry's path by carrying a prefix down instead of
    // calling path.relative per entry (the expensive way). Nested, spaced and
    // non-ASCII names all have to come out the same.
    const mgr = newManager();
    const expected = [
      "a.md",
      "café/über/note.md",
      "deep/deeper/deepest/leaf.md",
      "with space/and.another/x.md",
    ];
    for (const rel of expected) mgr.writeText(rel, "x");
    expect(mgr.listAllPaths()).toEqual(expected);
    // ...and every one of them still resolves back to a real file.
    for (const rel of mgr.listAllPaths()) expect(mgr.readText(rel)).toBe("x");
  });
});

// OPT-IN, and it asserts nothing about wall clock. A millisecond ceiling here
// would compare timings taken on a box running a dozen other workspaces' suites
// in parallel, so a GC pause flips it red for a machine hiccup rather than a
// regression. The properties that must not regress — zero stats per listing,
// one stat per file per snapshot, a sweep that yields — are counts, and are
// asserted deterministically above. This block exists to print the numbers:
//   VAULT_BENCH_FILES=50000 pnpm --filter @repo/vault test
/** The cost shape a single walk-plus-stat pass has: every entry's relative path
 * derived with path.relative, and a stat for every file before anything is
 * returned. Not a copy of the crawl — an ORACLE for the shape the crawl avoids,
 * so the benchmark carries its own baseline instead of quoting a number nobody
 * can re-measure. */
function eagerWalkAndStatOracle(dir: string): number {
  let stats = 0;
  const visit = (current: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (dirent.isDirectory()) {
        visit(full);
      } else if (dirent.isFile()) {
        try {
          fs.statSync(path.join(root, rel));
          stats++;
        } catch {
          /* the eager sweep drops it */
        }
      }
    }
  };
  visit(dir);
  return stats;
}

describe.skipIf(BENCH_FILES <= 0)("crawl benchmark", () => {
  it(`reports crawl cost at ${BENCH_FILES} files`, async () => {
    const mgr = newManager();
    const buildStart = performance.now();
    seed(BENCH_FILES, Math.max(1, Math.round(BENCH_FILES / 100)));
    const buildMs = performance.now() - buildStart;

    const oracleLoop = watchEventLoop();
    const oracleStart = performance.now();
    expect(eagerWalkAndStatOracle(root)).toBe(BENCH_FILES);
    const oracleMs = performance.now() - oracleStart;
    oracleLoop.stop();

    const report: string[] = [
      `build=${buildMs.toFixed(0)}ms`,
      `eager walk+stat oracle=${oracleMs.toFixed(0)}ms (one block)`,
    ];
    for (const round of ["cold", "uncached"]) {
      const listStart = performance.now();
      const entries = mgr.list();
      const listMs = performance.now() - listStart;
      expect(entries).toHaveLength(BENCH_FILES);

      mgr.refresh(); // drop the snapshot: the sweep pays for its own fresh walk
      const loop = watchEventLoop();
      const sweepStart = performance.now();
      const withStats = await mgr.listWithStats();
      const sweepMs = performance.now() - sweepStart;
      const { turns, longestBlockMs } = loop.stop();
      expect(withStats).toHaveLength(BENCH_FILES);

      report.push(
        `${round}: list=${listMs.toFixed(0)}ms | ` +
          `listWithStats total=${sweepMs.toFixed(0)}ms slices=${turns} ` +
          `longest-block=${longestBlockMs}ms`,
      );
      mgr.refresh();
    }
    console.log(`[vault crawl @ ${BENCH_FILES} files] ${report.join(" | ")}`);
  }, 600_000);
});
