// Driver conformance: @repo/notes' SQL KnowledgeStore drives the
// better-sqlite3 binding exactly as it drives every other platform's, so
// these tests exercise the store's own statements — schema init, FTS5 search,
// hydration paging, the version/root guards and the reset primitive — over a
// real file on disk.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocProjection } from "@repo/notes/knowledge/projection";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../knowledge-runtime";
import { createSqliteDriver } from "../sqlite-driver";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) cleanup();
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-knowledge-driver-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "knowledge.db");
}

function openStore(dbPath: string, vaultRoot = "/vault"): SqlKnowledgeStore {
  const store = createSqlKnowledgeStore(createSqliteDriver(dbPath), vaultRoot);
  cleanups.push(() => {
    try {
      store.dispose();
    } catch {
      // already disposed by the test
    }
  });
  return store;
}

function docRow(
  path: string,
  content: string,
): { row: Parameters<SqlKnowledgeStore["upsertDoc"]>[0]; body: string } {
  const projection: DocProjection = projectDoc(path, content);
  return { row: { path, contentHash: sha256Hex(content), projection }, body: content };
}

function seed(store: SqlKnowledgeStore): void {
  const alpha = docRow("alpha.md", "# Alpha Note\n\nBody about zebras.\n");
  const beta = docRow("beta.md", "# Beta Note\n\nAlpha appears only in this body.\n");
  store.upsertDoc(alpha.row, alpha.body);
  store.upsertDoc(beta.row, beta.body);
  store.upsertOther("img/pic.png");
}

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
