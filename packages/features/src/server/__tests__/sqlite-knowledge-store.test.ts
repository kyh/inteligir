// ---------------------------------------------------------------------------
// The SQL knowledge store over the REAL node:sqlite (system Node ships the
// same module Electron bundles). Ordering assertions are INVARIANTS (title
// hit beats body-only hit, AND semantics, last-token prefix) — never exact
// bm25 scores, which are corpus-statistics-dependent.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { KnowledgeStore, StoredDocRow } from "@repo/core/knowledge/knowledge-store";
import { projectDoc } from "@repo/core/knowledge/projection";

import { createSqliteKnowledgeStore, indexDbPathFor } from "../knowledge/sqlite-knowledge-store";

const ROOT = "/test/vault";

let tmp: string;
let stores: KnowledgeStore[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-store-"));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function open(dbPath = ":memory:", root = ROOT): KnowledgeStore {
  const store = createSqliteKnowledgeStore(dbPath, root);
  stores.push(store);
  return store;
}

function docRow(docPath: string, content: string, at = 1000): StoredDocRow {
  return {
    path: docPath,
    fingerprint: { mtimeMs: at, size: content.length, ino: at + 7 },
    contentHash: `hash-of-${docPath}-${content.length}`,
    projection: projectDoc(docPath, content),
  };
}

function upsert(store: KnowledgeStore, docPath: string, content: string, at = 1000): StoredDocRow {
  const row = docRow(docPath, content, at);
  store.upsertDoc(row, content);
  return row;
}

const HUB = [
  "# Hub",
  "",
  "Links: [[target note]], aliased [[target note|the target]], anchored [[target note#Section]].",
  "",
  "Embed: ![[diagram.png]] and md [other](notes/other.md).",
  "",
  "Tagged #meta and #demo/deep here.",
].join("\n");

describe("sqlite-knowledge-store — round trip", () => {
  it("loadAll returns exactly what was upserted (docs, links, headings, tags, others)", () => {
    const store = open();
    const hub = upsert(store, "wiki/hub.md", HUB, 1111);
    const other = upsert(store, "notes/other.md", "# Other\n\n## Sub\n\nBody.\n", 2222);
    store.upsertOther("diagram.png");
    store.upsertOther("assets/paper.pdf");

    const loaded = store.loadAll();
    expect(loaded.others.map((o) => o.path)).toEqual(["assets/paper.pdf", "diagram.png"]);
    expect(loaded.docs).toHaveLength(2);
    const byPath = new Map(loaded.docs.map((d) => [d.path, d]));
    // Deep equality pins every column round-trip: fingerprints, hashes, and
    // the full projection incl. optional anchor/alias/targetSpan fields.
    expect(byPath.get("wiki/hub.md")).toEqual(hub);
    expect(byPath.get("notes/other.md")).toEqual(other);
  });

  it("re-upserting a doc replaces its child rows instead of appending", () => {
    const store = open();
    upsert(store, "a.md", "# A\n\n[[one]] and [[two]] with #tag-a\n");
    upsert(store, "a.md", "# A2\n\n[[three]]\n", 2000);
    const docs = store.loadAll().docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]?.projection.title).toBe("A2");
    expect(docs[0]?.projection.links.map((l) => l.target)).toEqual(["three"]);
    expect(docs[0]?.projection.tags).toEqual([]);
  });

  it("a doc flipping to `other` drops projection rows and its search entry", () => {
    const store = open();
    upsert(store, "weird.md", "# Weird\n\n[[link]]\n");
    store.upsertOther("weird.md");
    const loaded = store.loadAll();
    expect(loaded.docs).toEqual([]);
    expect(loaded.others.map((o) => o.path)).toEqual(["weird.md"]);
    expect(store.search("weird", 10)).toEqual([]);
  });

  it("remove cascades child rows and the search corpus entry", () => {
    const store = open();
    upsert(store, "wiki/hub.md", HUB);
    upsert(store, "keep.md", "# Keep\n");
    store.remove("wiki/hub.md");
    const loaded = store.loadAll();
    expect(loaded.docs.map((d) => d.path)).toEqual(["keep.md"]);
    expect(loaded.docs[0]?.projection.links).toEqual([]);
    expect(store.search("aliased", 10)).toEqual([]);
    // Removing an unknown path is a no-op, not a throw.
    store.remove("never-was.md");
  });

  it("clear empties every table but keeps the schema serving", () => {
    const store = open();
    upsert(store, "a.md", "# A\n");
    store.upsertOther("b.png");
    store.clear();
    expect(store.loadAll()).toEqual({ docs: [], others: [] });
    expect(store.search("a", 10)).toEqual([]);
    upsert(store, "c.md", "# C\n");
    expect(store.loadAll().docs.map((d) => d.path)).toEqual(["c.md"]);
  });

  it("updateFingerprint persists without touching projection or search corpus", () => {
    const dbPath = path.join(tmp, "fp.sqlite");
    const first = open(dbPath);
    const row = upsert(first, "a.md", "# Alpha\n\nBody stays.\n", 1000);
    first.updateFingerprint("a.md", { mtimeMs: 9999, size: row.fingerprint.size, ino: 42 });
    first.dispose();

    const second = open(dbPath);
    const loaded = second.loadAll().docs[0];
    expect(loaded?.fingerprint).toEqual({ mtimeMs: 9999, size: row.fingerprint.size, ino: 42 });
    expect(loaded?.contentHash).toBe(row.contentHash);
    expect(loaded?.projection).toEqual(row.projection);
    expect(second.search("alpha", 10)[0]?.path).toBe("a.md");
  });
});

describe("sqlite-knowledge-store — search invariants", () => {
  it("ranks a title hit above a body-only hit", () => {
    const store = open();
    upsert(store, "alpha.md", "# Migration plan\n\nDetails here.\n");
    upsert(store, "beta.md", "# Other\n\nmigration mentioned in the body\n");
    const results = store.search("migration", 10);
    expect(results.map((r) => r.path)).toEqual(["alpha.md", "beta.md"]);
    expect(results[0]?.title).toBe("Migration plan");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? Number.POSITIVE_INFINITY);
  });

  it("ANDs across tokens — a doc must match every token", () => {
    const store = open();
    upsert(store, "both.md", "# Sync engine\n\nvault sync engine notes\n");
    upsert(store, "one.md", "# Sync\n\nonly sync here\n");
    expect(store.search("sync engine", 10).map((r) => r.path)).toEqual(["both.md"]);
  });

  it("prefix-matches the last token only (search-as-you-type)", () => {
    const store = open();
    upsert(store, "roadmap.md", "# Roadmap\n\nplanning ahead\n");
    upsert(store, "road.md", "# Road\n\njust a road\n");
    const hits = store.search("roadm", 10).map((r) => r.path);
    expect(hits).toEqual(["roadmap.md"]);
    // A NON-last token does not prefix-match: "roadm just" matches nothing
    // ("roadm" is not a whole token anywhere).
    expect(store.search("roadm just", 10)).toEqual([]);
  });

  it("keeps `_` inside tokens, matching core tokenize()", () => {
    const store = open();
    upsert(store, "snake.md", "# Notes\n\ncall create_host at boot\n");
    expect(store.search("create_host", 10).map((r) => r.path)).toEqual(["snake.md"]);
    expect(store.search("create_h", 10).map((r) => r.path)).toEqual(["snake.md"]);
  });

  it("returns [] for an empty/tokenless query and respects the limit", () => {
    const store = open();
    upsert(store, "a.md", "# A\n\ncommon term\n");
    upsert(store, "b.md", "# B\n\ncommon term\n");
    expect(store.search("", 10)).toEqual([]);
    expect(store.search("  …  ", 10)).toEqual([]);
    expect(store.search("common", 1)).toHaveLength(1);
  });

  it("serves a snippet, falling back to the title when the body is empty", () => {
    const store = open();
    // An empty file: its title is filename-derived, its body column is "" —
    // the one case snippet() has nothing to show.
    upsert(store, "special heading.md", "");
    upsert(store, "with-body.md", "# T\n\nthe matching heading line is here\n");
    const hits = store.search("heading", 10);
    const byPath = new Map(hits.map((h) => [h.path, h]));
    expect(byPath.get("special heading.md")?.snippet).toBe("special heading");
    expect(byPath.get("with-body.md")?.snippet).toContain("matching heading line");
  });
});

describe("sqlite-knowledge-store — guards and recovery", () => {
  it("a projection_version mismatch discards the file and reopens empty", () => {
    const dbPath = path.join(tmp, "pv.sqlite");
    const first = open(dbPath);
    upsert(first, "a.md", "# A\n");
    first.dispose();

    const raw = new DatabaseSync(dbPath);
    raw.exec("UPDATE meta SET value = '9999' WHERE key = 'projection_version'");
    raw.close();

    const second = open(dbPath);
    expect(second.loadAll()).toEqual({ docs: [], others: [] });
    upsert(second, "b.md", "# B\n");
    expect(second.loadAll().docs.map((d) => d.path)).toEqual(["b.md"]);
  });

  it("a vault_root mismatch discards the file and reopens empty", () => {
    const dbPath = path.join(tmp, "vr.sqlite");
    const first = open(dbPath, "/vault/one");
    upsert(first, "a.md", "# A\n");
    first.dispose();

    const second = open(dbPath, "/vault/two");
    expect(second.loadAll()).toEqual({ docs: [], others: [] });
  });

  it("a schema user_version mismatch discards the file and reopens empty", () => {
    const dbPath = path.join(tmp, "uv.sqlite");
    const first = open(dbPath);
    upsert(first, "a.md", "# A\n");
    first.dispose();

    const raw = new DatabaseSync(dbPath);
    raw.exec("PRAGMA user_version = 9999");
    raw.close();

    expect(open(dbPath).loadAll()).toEqual({ docs: [], others: [] });
  });

  it("garbage bytes on disk recreate cleanly (including WAL/SHM siblings)", () => {
    const dbPath = path.join(tmp, "garbage.sqlite");
    fs.writeFileSync(dbPath, "this is not a sqlite database, not even close");
    fs.writeFileSync(`${dbPath}-wal`, "stale wal");
    const store = open(dbPath);
    upsert(store, "a.md", "# A\n");
    expect(store.loadAll().docs.map((d) => d.path)).toEqual(["a.md"]);
  });

  it("nuke() rebuilds empty and keeps serving — and never unlinks :memory:", () => {
    const store = open(); // :memory:
    upsert(store, "a.md", "# A\n");
    store.nuke();
    expect(store.loadAll()).toEqual({ docs: [], others: [] });
    upsert(store, "b.md", "# B\n");
    expect(store.search("b", 10).map((r) => r.path)).toEqual(["b.md"]);
  });

  it("a matching file reopens WITH its data (persistence across instances)", () => {
    const dbPath = path.join(tmp, "persist.sqlite");
    const first = open(dbPath);
    const row = upsert(first, "wiki/hub.md", HUB, 4242);
    first.upsertOther("diagram.png");
    first.dispose();

    const second = open(dbPath);
    const loaded = second.loadAll();
    expect(loaded.docs).toEqual([row]);
    expect(loaded.others.map((o) => o.path)).toEqual(["diagram.png"]);
    expect(second.search("aliased", 5)[0]?.path).toBe("wiki/hub.md");
  });
});

describe("sqlite-knowledge-store — rebuild equivalence (the cache contract)", () => {
  it("nuke → rebuild from the same inputs → identical query outputs", () => {
    const corpus: Array<[string, string]> = [
      ["wiki/hub.md", HUB],
      ["notes/other.md", "# Other\n\n## Sub\n\nsync engine details\n"],
      ["journal.md", "# Journal\n\nmigration notes with #meta\n"],
    ];
    const store = open(path.join(tmp, "rebuild.sqlite"));
    const build = (): void => {
      store.transaction(() => {
        for (const [p, content] of corpus) upsert(store, p, content);
        store.upsertOther("diagram.png");
      });
    };
    build();
    const before = {
      loadAll: store.loadAll(),
      searches: ["migration", "sync eng", "hub", "meta"].map((q) => store.search(q, 10)),
    };
    store.nuke();
    build();
    expect(store.loadAll()).toEqual(before.loadAll);
    expect(["migration", "sync eng", "hub", "meta"].map((q) => store.search(q, 10))).toEqual(
      before.searches,
    );
  });
});

describe("indexDbPathFor", () => {
  it("keys by vault root under ~/.inteligir/indexes and stays stable", () => {
    const a = indexDbPathFor("/vault/one");
    const b = indexDbPathFor("/vault/two");
    expect(a).toContain(`${path.sep}indexes${path.sep}`);
    expect(a).toMatch(/[0-9a-f]{16}\.sqlite$/);
    expect(a).not.toBe(b);
    expect(indexDbPathFor("/vault/one")).toBe(a);
  });
});

describe("sqlite-knowledge-store — privacy (is_private)", () => {
  it("round-trips projection.private through loadAll", () => {
    const store = open();
    upsert(store, "secret.md", "---\nprivate: true\n---\n# Secret\n");
    upsert(store, "open.md", "# Open\n");
    const { docs } = store.loadAll();
    const byPath = new Map(docs.map((d) => [d.path, d.projection.private]));
    expect(byPath.get("secret.md")).toBe(true);
    expect(byPath.get("open.md")).toBe(false);
  });

  it("excludePrivate filters search inside the query; default search sees all", () => {
    const store = open();
    upsert(store, "secret.md", "---\nprivate: true\n---\n# Secret\n\nrocket plans\n");
    upsert(store, "broken.md", "---\n[not: valid: yaml\n---\nrocket plans too\n");
    upsert(store, "open.md", "# Open\n\nrocket plans three\n");
    expect(
      store
        .search("rocket", 10)
        .map((h) => h.path)
        .toSorted(),
    ).toEqual(["broken.md", "open.md", "secret.md"]);
    const filtered = store.search("rocket", 10, { excludePrivate: true });
    expect(filtered.map((h) => h.path)).toEqual(["open.md"]);
    // The private path/title/snippet never even transit the result payload.
    expect(JSON.stringify(filtered)).not.toContain("secret");
  });

  it("a doc turning public updates the filter on re-upsert", () => {
    const store = open();
    upsert(store, "note.md", "---\nprivate: true\n---\nrocket\n");
    expect(store.search("rocket", 10, { excludePrivate: true })).toEqual([]);
    upsert(store, "note.md", "rocket, now public\n", 2000);
    expect(store.search("rocket", 10, { excludePrivate: true }).map((h) => h.path)).toEqual([
      "note.md",
    ]);
  });
});
