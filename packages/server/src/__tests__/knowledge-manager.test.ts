import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { KnowledgeStore } from "@repo/notes/knowledge/knowledge-store";

import { KnowledgeManager } from "../knowledge/knowledge-manager";
import { createSqliteKnowledgeStore } from "../knowledge/sqlite-knowledge-store";
import { VaultManager } from "@repo/vault/vault";

let tmp: string;
let root: string;
let settingsPath: string;
let vault: VaultManager;
let updates: number[];
let manager: KnowledgeManager;
/** Store-write counters, reset per open — pins "hydration means zero writes". */
let counts: { upsertDoc: number; updateFingerprint: number };

/** Wrap a store so tests can count the writes that reach it. */
function countingStore(store: KnowledgeStore): KnowledgeStore {
  return {
    ...store,
    upsertDoc: (row, body) => {
      counts.upsertDoc++;
      store.upsertDoc(row, body);
    },
    updateFingerprint: (p, fp) => {
      counts.updateFingerprint++;
      store.updateFingerprint(p, fp);
    },
  };
}

function newManager(openStore?: (r: string) => KnowledgeStore): KnowledgeManager {
  return new KnowledgeManager(
    () => vault,
    (revision) => updates.push(revision),
    openStore ?? ((r) => countingStore(createSqliteKnowledgeStore(":memory:", r))),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-test-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
  vault = new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
  vault.ensureReady();
  updates = [];
  counts = { upsertDoc: 0, updateFingerprint: 0 };
  manager = newManager();
});

afterEach(() => {
  manager.dispose();
  vault.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KnowledgeManager", () => {
  it("hydrates lazily on the first query, then reconciles async", async () => {
    vault.writeText("hub.md", "links to [[target]]\n");
    vault.writeText("target.md", "# Target\n");
    // First query: the store is empty (nothing persisted yet) so it answers
    // empty immediately — the kicked reconcile fills in and broadcasts.
    expect(manager.backlinks("target.md")).toEqual([]);
    await manager.refreshDone();
    expect(manager.backlinks("target.md")).toEqual([
      expect.objectContaining({ sourcePath: "hub.md", snippet: "links to [[target]]" }),
    ]);
    expect(updates).toEqual([1]);
  });

  it("picks up writes incrementally and bumps the revision", async () => {
    vault.writeText("target.md", "# Target\n");
    await manager.refresh();
    expect(manager.backlinks("target.md")).toEqual([]);

    vault.writeText("hub.md", "now links to [[target]]\n");
    await manager.refresh();
    expect(manager.backlinks("target.md")).toHaveLength(1);
    expect(updates).toEqual([1, 2]);
  });

  it("re-indexes an atomic swap that collides on mtime and size (ino differs)", async () => {
    const abs = path.join(root, "note.md");
    const pinned = new Date("2026-01-01T00:00:00Z");
    vault.writeText("note.md", "links [[alpha]]\n");
    fs.utimesSync(abs, pinned, pinned);
    await manager.refresh();
    expect(manager.forwardLinks("note.md").map((l) => l.target)).toEqual(["alpha"]);

    // Same byte count, same pinned mtime — only the inode betrays the swap
    // (an atomic write always renames a fresh temp file into place).
    const swap = path.join(tmp, "swap.md");
    fs.writeFileSync(swap, "links [[bravo]]\n");
    fs.renameSync(swap, abs);
    fs.utimesSync(abs, pinned, pinned);
    // Out-of-band edits ride a refresh trigger in prod (focus / command) —
    // vault.refresh() is that trigger and drops the walk snapshot.
    vault.refresh();
    await manager.refresh();
    expect(manager.forwardLinks("note.md").map((l) => l.target)).toEqual(["bravo"]);
    expect(updates).toEqual([1, 2]);
  });

  it("does not emit when nothing changed", async () => {
    vault.writeText("note.md", "# Note\n");
    await manager.refresh();
    await manager.refresh();
    expect(updates).toEqual([1]);
  });

  it("persists fingerprints on an mtime-only rewrite without re-projecting", async () => {
    vault.writeText("note.md", "# Note\n\nSame bytes.\n");
    await manager.refresh();
    expect(counts.upsertDoc).toBe(1);

    // Rewrite the identical content out of band (a sync-provider sweep): new
    // inode + mtime, same bytes → fingerprint persisted, zero projection/FTS
    // churn, no broadcast (nothing observable changed).
    const abs = path.join(root, "note.md");
    fs.writeFileSync(abs, "# Note\n\nSame bytes.\n");
    vault.refresh();
    await manager.refresh();
    expect(counts.upsertDoc).toBe(1);
    expect(counts.updateFingerprint).toBe(1);
    expect(updates).toEqual([1]);

    // The persisted fingerprint holds: the next pass is entirely quiet.
    vault.refresh();
    await manager.refresh();
    expect(counts.updateFingerprint).toBe(1);
  });

  it("drops deleted docs and re-dangles their targets", async () => {
    vault.writeText("hub.md", "[[target]]\n");
    vault.writeText("target.md", "# Target\n");
    await manager.refresh();
    expect(manager.backlinks("target.md")).toHaveLength(1);

    vault.delete("target.md");
    await manager.refresh();
    const forward = manager.forwardLinks("hub.md");
    expect(forward[0]?.targetPath).toBeNull();
    expect(manager.graph().nodes.some((n) => n.phantom)).toBe(true);
  });

  it("follows a rename on the next refresh", async () => {
    vault.writeText("hub.md", "[[old]]\n");
    vault.writeText("old.md", "# Old\n");
    await manager.refresh();
    expect(vault.rename("old.md", "new.md")).toEqual({ ok: true });
    await manager.refresh();
    const targets = manager.wikiTargets().map((t) => t.path);
    expect(targets).toContain("new.md");
    expect(targets).not.toContain("old.md");
  });

  it("rebuilds from scratch on a root switch with no cross-root leakage", async () => {
    vault.writeText("only-in-first.md", "# First\n");
    await manager.refresh();
    expect(manager.wikiTargets()).toHaveLength(1);

    const secondRoot = path.join(tmp, "vault-two");
    vault.setRoot(secondRoot);
    vault.writeText("second.md", "# Second\n");
    await manager.refresh();
    expect(manager.wikiTargets().map((t) => t.path)).toEqual(["second.md"]);
  });

  it("abandons an in-flight pass when the root switches under it", async () => {
    vault.writeText("only-in-first.md", "# First\n");
    const firstPass = manager.refresh(); // queued against the first root
    const secondRoot = path.join(tmp, "vault-two");
    vault.setRoot(secondRoot);
    vault.writeText("second.md", "# Second\n");
    await firstPass;
    await manager.refresh();
    // Whatever the interleaving, no first-root docs may leak into the index.
    expect(manager.wikiTargets().map((t) => t.path)).toEqual(["second.md"]);
  });

  it("indexes non-doc files for resolution and lists them as asset targets", async () => {
    vault.writeText("hub.md", "embed ![[pic.png]] and image ![alt](pic.png)\n");
    fs.writeFileSync(path.join(root, "pic.png"), "binary-ish");
    await manager.refresh();
    expect(manager.forwardLinks("hub.md").map((f) => f.targetPath)).toEqual(["pic.png", "pic.png"]);
    expect(manager.backlinks("pic.png")).toHaveLength(2);
    expect(manager.wikiTargets()).toEqual([
      { path: "hub.md", title: "hub", type: "doc" },
      { path: "pic.png", title: "pic.png", type: "asset" },
    ]);
  });

  it("serves ranked search over the vault (title hit beats body-only hit)", async () => {
    vault.writeText("alpha.md", "# Migration plan\n\nDetails here.\n");
    vault.writeText("beta.md", "# Other\n\nmigration mentioned in the body\n");
    await manager.refresh();
    const results = manager.search("migration");
    expect(results.map((r) => r.path)).toEqual(["alpha.md", "beta.md"]);
  });

  it("indexes tags from inline `#tags` and the frontmatter `tags` property", async () => {
    vault.writeText("a.md", "---\ntags: [meta, demo]\n---\n\n# A\n");
    vault.writeText("b.md", "# B\n\nInline #meta and #project here.\n");
    await manager.refresh();
    expect(manager.tags()).toEqual([
      { tag: "meta", count: 2 },
      { tag: "demo", count: 1 },
      { tag: "project", count: 1 },
    ]);
    expect(manager.notesWithTag("META")).toEqual(["a.md", "b.md"]);
    expect(manager.notesWithTag("project")).toEqual(["b.md"]);
  });

  it("drops a note's tags when it is deleted", async () => {
    vault.writeText("a.md", "# A\n\n#solo tag.\n");
    await manager.refresh();
    expect(manager.notesWithTag("solo")).toEqual(["a.md"]);
    vault.delete("a.md");
    await manager.refresh();
    expect(manager.notesWithTag("solo")).toEqual([]);
  });

  it("coalesces scheduleRefresh bursts through the debounce", async () => {
    // Only the debounce timer is faked — the pass itself awaits real
    // setImmediate yields, which faking would deadlock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vault.writeText("note.md", "# Note\n");
      manager.scheduleRefresh();
      manager.scheduleRefresh();
      manager.scheduleRefresh();
      expect(updates).toEqual([]);
      vi.advanceTimersByTime(100);
    } finally {
      vi.useRealTimers();
    }
    await manager.refreshDone();
    expect(updates).toEqual([1]);
  });

  it("answers instantly from the persisted projection on a relaunch (zero re-parses)", async () => {
    const dbPath = path.join(tmp, "index.sqlite");
    const openOnDisk = (r: string): KnowledgeStore =>
      countingStore(createSqliteKnowledgeStore(dbPath, r));

    manager.dispose();
    manager = newManager(openOnDisk);
    vault.writeText("hub.md", "links to [[target]] with #meta\n");
    vault.writeText("target.md", "# Target\n\nsearchable body\n");
    fs.writeFileSync(path.join(root, "pic.png"), "binary-ish");
    await manager.refresh();
    expect(counts.upsertDoc).toBe(2);
    manager.dispose();

    // Second launch over the same DB: hydration answers every query BEFORE
    // any reconcile ran, and the reconcile then re-writes nothing.
    counts = { upsertDoc: 0, updateFingerprint: 0 };
    updates = [];
    manager = newManager(openOnDisk);
    expect(manager.backlinks("target.md")).toEqual([
      expect.objectContaining({ sourcePath: "hub.md" }),
    ]);
    expect(manager.notesWithTag("meta")).toEqual(["hub.md"]);
    expect(manager.wikiTargets().map((t) => t.path)).toEqual(["hub.md", "target.md", "pic.png"]);
    expect(manager.search("searchable").map((r) => r.path)).toEqual(["target.md"]);
    await manager.refreshDone();
    expect(counts).toEqual({ upsertDoc: 0, updateFingerprint: 0 });
    expect(updates).toEqual([]);
  });

  it("recovers by rebuilding when the store throws mid-pass", async () => {
    let failNext = false;
    const openFlaky = (r: string): KnowledgeStore => {
      const store = createSqliteKnowledgeStore(":memory:", r);
      return {
        ...store,
        upsertDoc: (row, body) => {
          if (failNext) {
            failNext = false;
            throw new Error("injected store failure");
          }
          store.upsertDoc(row, body);
        },
      };
    };
    manager.dispose();
    manager = newManager(openFlaky);
    vault.writeText("a.md", "# A\n\n[[b]]\n");
    failNext = true;
    await manager.refresh(); // first pass throws, recovery pass rebuilds
    expect(manager.forwardLinks("a.md").map((l) => l.target)).toEqual(["b"]);
  });
});
