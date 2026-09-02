// Driver conformance, two layers. The driver-level suite exercises the
// binding itself: parameter binding, error propagation, the reset primitive,
// and the recovery ladder that must never let a bad file abort product boot.
// The store-level suite drives @repo/notes' SQL KnowledgeStore over the
// driver exactly as it drives every other platform's — schema init, FTS5
// search, hydration paging, the version/root guards.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocProjection } from "@repo/notes/knowledge/projection";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlDriver,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";

function makeDbDir(): string {
  const dir = makeTempDir("inteligir-knowledge-driver-");
  // A test drops the dir's write bit; registered after the dir, this restore
  // runs before the dir's own removal, so the removal can succeed.
  onTestFinished(() => chmodSync(dir, 0o755));
  return dir;
}

function makeDbPath(): string {
  return join(makeDbDir(), "knowledge.db");
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function openStore(dbPath: string, vaultRoot = "/vault"): SqlKnowledgeStore {
  const store = createSqlKnowledgeStore(createSqliteDriver(dbPath), vaultRoot);
  onTestFinished(() => {
    try {
      store.dispose();
    } catch {
      // already disposed by the test
    }
  });
  return store;
}

function docRow(path: string, content: string) {
  const projection: DocProjection = projectDoc(path, content);
  const row: Parameters<SqlKnowledgeStore["upsertDoc"]>[0] = {
    path,
    contentHash: sha256Hex(content),
    projection,
  };
  return { row, body: content };
}

function seed(store: SqlKnowledgeStore): void {
  const alpha = docRow("alpha.md", "# Alpha Note\n\nBody about zebras.\n");
  const beta = docRow("beta.md", "# Beta Note\n\nAlpha appears only in this body.\n");
  store.upsertDoc(alpha.row, alpha.body);
  store.upsertDoc(beta.row, beta.body);
  store.upsertOther("img/pic.png");
}

function openDriver(dbPath: string): SqlDriver {
  const driver = createSqliteDriver(dbPath);
  onTestFinished(() => {
    try {
      driver.close();
    } catch {
      // already closed by the test
    }
  });
  return driver;
}

describe("the sqlite driver", () => {
  it("binds null, integer, float and text and reads them back", () => {
    const driver = openDriver(makeDbPath());
    driver.exec("CREATE TABLE t (a, b, c, d)");
    driver.run("INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, ?)", [null, 42, 1.5, "text"]);
    expect(driver.all("SELECT a, b, c, d FROM t", [])).toEqual([
      { a: null, b: 42, c: 1.5, d: "text" },
    ]);
  });

  it("propagates errors from bad SQL on every entry point", () => {
    const driver = openDriver(makeDbPath());
    expect(() => driver.exec("NOT SQL")).toThrow();
    expect(() => driver.run("INSERT INTO missing VALUES (?)", [1])).toThrow();
    expect(() => driver.all("SELECT * FROM missing", [])).toThrow();
  });

  it("reset() drops the file's contents and stays usable", () => {
    const dbPath = makeDbPath();
    const driver = openDriver(dbPath);
    driver.exec("CREATE TABLE t (a)");
    driver.run("INSERT INTO t (a) VALUES (?)", ["kept?"]);
    driver.reset();
    expect(driver.all("SELECT name FROM sqlite_master WHERE name = 't'", [])).toEqual([]);
    driver.exec("CREATE TABLE t (a)");
    expect(driver.all("SELECT count(*) AS n FROM t", [])).toEqual([{ n: 0 }]);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("recovers a corrupt file at open by discarding it", () => {
    const dbPath = makeDbPath();
    writeFileSync(dbPath, "this is not a sqlite database, not even close");
    const driver = openDriver(dbPath);
    driver.exec("CREATE TABLE t (a)");
    driver.run("INSERT INTO t (a) VALUES (?)", ["fresh"]);
    expect(driver.all("SELECT a FROM t", [])).toEqual([{ a: "fresh" }]);
  });

  it("falls back to memory when the corrupt file can be neither deleted nor renamed", () => {
    const dir = makeDbDir();
    const dbPath = join(dir, "knowledge.db");
    writeFileSync(dbPath, "garbage that will not open");
    // A read-only parent refuses unlink AND rename — the ladder's last rung.
    chmodSync(dir, 0o555);
    const driver = openDriver(dbPath);
    chmodSync(dir, 0o755);
    driver.exec("CREATE TABLE t (a)");
    driver.run("INSERT INTO t (a) VALUES (?)", ["in-memory"]);
    expect(driver.all("SELECT a FROM t", [])).toEqual([{ a: "in-memory" }]);
    // Boot survived; the corrupt file is still there, untouched.
    expect(readdirSync(dir)).toContain("knowledge.db");
  });
});

describe("the better-sqlite3 knowledge store", () => {
  it("round-trips docs through upsert, search and loadAll", () => {
    const store = openStore(makeDbPath());
    seed(store);

    const { docs, others } = store.loadAll();
    expect(docs.map((d) => d.path)).toEqual(["alpha.md", "beta.md"]);
    expect(docs[0]?.projection.title).toBe("Alpha Note");
    expect(others).toEqual([{ path: "img/pic.png" }]);

    // bm25 weighting: a title hit outranks a body-only hit.
    const hits = store.search("alpha", 10);
    expect(hits.map((h) => h.path)).toEqual(["alpha.md", "beta.md"]);

    store.remove("alpha.md");
    expect(store.search("zebras", 10)).toEqual([]);
    expect(store.loadAll().docs.map((d) => d.path)).toEqual(["beta.md"]);
  });

  it("persists across close and reopen from the same file", () => {
    const dbPath = makeDbPath();
    const first = openStore(dbPath);
    seed(first);
    first.dispose();

    const second = openStore(dbPath);
    expect(second.loadAll().docs).toHaveLength(2);
    expect(second.search("zebras", 10).map((h) => h.path)).toEqual(["alpha.md"]);
  });

  it("pages hydration by keyset, docs before others", () => {
    const store = openStore(makeDbPath());
    seed(store);

    const cursor = store.hydrate(1);
    const pages: string[][] = [];
    for (;;) {
      const page = cursor.next();
      if (page.kind === "done") break;
      pages.push(
        page.kind === "docs" ? page.docs.map((d) => d.path) : page.others.map((o) => o.path),
      );
    }
    expect(pages).toEqual([["alpha.md"], ["beta.md"], ["img/pic.png"]]);
  });

  it("rolls a failed transaction back", () => {
    const store = openStore(makeDbPath());
    seed(store);

    expect(() =>
      store.transaction(() => {
        const extra = docRow("gamma.md", "# Gamma\n");
        store.upsertDoc(extra.row, extra.body);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.loadAll().docs.map((d) => d.path)).toEqual(["alpha.md", "beta.md"]);
  });

  it("wipes and rebuilds when the vault root changed", () => {
    const dbPath = makeDbPath();
    const first = openStore(dbPath, "/vault-a");
    seed(first);
    first.dispose();

    const second = openStore(dbPath, "/vault-b");
    expect(second.loadAll().docs).toEqual([]);
  });

  it("opens over a corrupt file as an empty store instead of failing boot", () => {
    const dbPath = makeDbPath();
    writeFileSync(dbPath, "not a sqlite file at all");
    const store = openStore(dbPath);
    expect(store.loadAll()).toEqual({ docs: [], others: [] });
    seed(store);
    expect(store.search("zebras", 10).map((h) => h.path)).toEqual(["alpha.md"]);
  });

  it("nuke() deletes the files and leaves a working empty store", () => {
    const dbPath = makeDbPath();
    const store = openStore(dbPath);
    seed(store);

    store.nuke();
    expect(store.loadAll()).toEqual({ docs: [], others: [] });
    expect(existsSync(dbPath)).toBe(true);

    // Still writable after the reset.
    const gamma = docRow("gamma.md", "# Gamma\n\nquokka\n");
    store.upsertDoc(gamma.row, gamma.body);
    expect(store.search("quokka", 10).map((h) => h.path)).toEqual(["gamma.md"]);
  });
});
