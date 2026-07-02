import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KnowledgeManager } from "../knowledge/knowledge-manager";
import { VaultManager } from "../vault/vault";

let tmp: string;
let root: string;
let settingsPath: string;
let vault: VaultManager;
let updates: number[];
let manager: KnowledgeManager;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-test-"));
  root = path.join(tmp, "vault");
  settingsPath = path.join(tmp, "settings.json");
  vault = new VaultManager({ settingsPath, defaultRoot: root, manageAgentLink: false });
  vault.ensureReady();
  updates = [];
  manager = new KnowledgeManager(
    () => vault,
    (revision) => updates.push(revision),
  );
});

afterEach(() => {
  manager.dispose();
  vault.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KnowledgeManager", () => {
  it("builds lazily on the first query", () => {
    vault.writeText("hub.md", "links to [[target]]\n");
    vault.writeText("target.md", "# Target\n");
    const backlinks = manager.backlinks("target.md");
    expect(backlinks).toEqual([
      expect.objectContaining({ sourcePath: "hub.md", snippet: "links to [[target]]" }),
    ]);
    expect(updates).toEqual([1]);
  });

  it("picks up writes incrementally and bumps the revision", () => {
    vault.writeText("target.md", "# Target\n");
    manager.refresh();
    expect(manager.backlinks("target.md")).toEqual([]);

    vault.writeText("hub.md", "now links to [[target]]\n");
    manager.refresh();
    expect(manager.backlinks("target.md")).toHaveLength(1);
    expect(updates).toEqual([1, 2]);
  });

  it("re-indexes an atomic swap that collides on mtime and size (ino differs)", () => {
    const abs = path.join(root, "note.md");
    const pinned = new Date("2026-01-01T00:00:00Z");
    vault.writeText("note.md", "links [[alpha]]\n");
    fs.utimesSync(abs, pinned, pinned);
    manager.refresh();
    expect(manager.forwardLinks("note.md").map((l) => l.target)).toEqual(["alpha"]);

    // Same byte count, same pinned mtime — only the inode betrays the swap
    // (an atomic write always renames a fresh temp file into place).
    const swap = path.join(tmp, "swap.md");
    fs.writeFileSync(swap, "links [[bravo]]\n");
    fs.renameSync(swap, abs);
    fs.utimesSync(abs, pinned, pinned);
    manager.refresh();
    expect(manager.forwardLinks("note.md").map((l) => l.target)).toEqual(["bravo"]);
    expect(updates).toEqual([1, 2]);
  });

  it("does not emit when nothing changed", () => {
    vault.writeText("note.md", "# Note\n");
    manager.refresh();
    manager.refresh();
    expect(updates).toEqual([1]);
  });

  it("drops deleted docs and re-dangles their targets", () => {
    vault.writeText("hub.md", "[[target]]\n");
    vault.writeText("target.md", "# Target\n");
    manager.refresh();
    expect(manager.backlinks("target.md")).toHaveLength(1);

    vault.delete("target.md");
    manager.refresh();
    const forward = manager.forwardLinks("hub.md");
    expect(forward[0]?.targetPath).toBeNull();
    expect(manager.graph().nodes.some((n) => n.phantom)).toBe(true);
  });

  it("follows a rename on the next refresh", () => {
    vault.writeText("hub.md", "[[old]]\n");
    vault.writeText("old.md", "# Old\n");
    manager.refresh();
    expect(vault.rename("old.md", "new.md")).toEqual({ ok: true });
    manager.refresh();
    const targets = manager.wikiTargets().map((t) => t.path);
    expect(targets).toContain("new.md");
    expect(targets).not.toContain("old.md");
  });

  it("rebuilds from scratch on a root switch", () => {
    vault.writeText("only-in-first.md", "# First\n");
    manager.refresh();
    expect(manager.wikiTargets()).toHaveLength(1);

    const secondRoot = path.join(tmp, "vault-two");
    vault.setRoot(secondRoot);
    vault.writeText("second.md", "# Second\n");
    manager.refresh();
    expect(manager.wikiTargets().map((t) => t.path)).toEqual(["second.md"]);
  });

  it("indexes non-doc files for resolution but not as wiki targets", () => {
    vault.writeText("hub.md", "embed ![[pic.png]]\n");
    fs.writeFileSync(path.join(root, "pic.png"), "binary-ish");
    manager.refresh();
    expect(manager.forwardLinks("hub.md")[0]?.targetPath).toBe("pic.png");
    expect(manager.wikiTargets().map((t) => t.path)).toEqual(["hub.md"]);
  });

  it("serves ranked search over the vault", () => {
    vault.writeText("alpha.md", "# Migration plan\n\nDetails here.\n");
    vault.writeText("beta.md", "# Other\n\nmigration mentioned in the body\n");
    manager.refresh();
    const results = manager.search("migration");
    expect(results.map((r) => r.path)).toEqual(["alpha.md", "beta.md"]);
  });

  it("coalesces scheduleRefresh bursts through the debounce", () => {
    vi.useFakeTimers();
    try {
      vault.writeText("note.md", "# Note\n");
      manager.scheduleRefresh();
      manager.scheduleRefresh();
      manager.scheduleRefresh();
      expect(updates).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(updates).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
