import { describe, expect, it } from "vitest";

import type { LocalFile, LocalManifest, VaultManifest } from "../manifest";
import { conflictCopyName, reconcile } from "../reconcile";
import type { VaultFile } from "../vault-file";

const VAULT = "vault-1";

function remote(path: string, hash: string, version: number): VaultFile {
  return { path, contentHash: hash, version, size: hash.length };
}
function local(path: string, hash: string): LocalFile {
  return { path, contentHash: hash, size: hash.length };
}
function coordinatorManifest(generation: number, files: readonly VaultFile[]): VaultManifest {
  return { vaultId: VAULT, generation, files };
}
function deviceManifest(files: readonly LocalFile[]): LocalManifest {
  return { vaultId: VAULT, files };
}

describe("reconcile", () => {
  it("no change on either side -> empty plan", () => {
    const file = remote("a.md", "h1", 1);
    const plan = reconcile(
      coordinatorManifest(1, [file]),
      deviceManifest([local("a.md", "h1")]),
      coordinatorManifest(1, [file]),
    );
    expect(plan.ops).toEqual([]);
  });

  describe("one-sided push", () => {
    it("local edit, remote unchanged -> push at the remote's version", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h2")]),
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
      );
      expect(plan.ops).toEqual([{ kind: "push", path: "a.md", expectedBaseVersion: 1 }]);
    });

    it("new local file -> push as a create (ABSENT_VERSION)", () => {
      const empty = coordinatorManifest(0, []);
      const plan = reconcile(empty, deviceManifest([local("new.md", "h1")]), empty);
      expect(plan.ops).toEqual([{ kind: "push", path: "new.md", expectedBaseVersion: 0 }]);
    });
  });

  describe("one-sided pull", () => {
    it("remote edit, local unchanged -> pull the remote file", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h1")]),
        coordinatorManifest(2, [remote("a.md", "h2", 2)]),
      );
      expect(plan.ops).toEqual([{ kind: "pull", file: remote("a.md", "h2", 2) }]);
    });

    it("new remote file -> pull", () => {
      const empty = coordinatorManifest(0, []);
      const plan = reconcile(
        empty,
        deviceManifest([]),
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
      );
      expect(plan.ops).toEqual([{ kind: "pull", file: remote("a.md", "h1", 1) }]);
    });
  });

  describe("delete", () => {
    it("local delete, remote unchanged -> delete on the coordinator (OCC-guarded)", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([]),
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
      );
      expect(plan.ops).toEqual([
        { kind: "delete", side: "remote", path: "a.md", expectedBaseVersion: 1 },
      ]);
    });

    it("remote delete, local unchanged -> delete locally", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h1")]),
        coordinatorManifest(2, []),
      );
      expect(plan.ops).toEqual([{ kind: "delete", side: "local", path: "a.md" }]);
    });

    it("both sides deleted -> converged, no op", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([]),
        coordinatorManifest(2, []),
      );
      expect(plan.ops).toEqual([]);
    });
  });

  describe("both sides changed", () => {
    it("edited on both -> conflict copy, remote wins the path (higher version)", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h2")]),
        coordinatorManifest(2, [remote("a.md", "h3", 2)]),
      );
      expect(plan.ops).toEqual([
        {
          kind: "conflict-copy",
          path: "a.md",
          winner: "remote",
          local: local("a.md", "h2"),
          remote: remote("a.md", "h3", 2),
        },
      ]);
    });

    it("both created the same path with different content -> conflict copy", () => {
      const empty = coordinatorManifest(0, []);
      const plan = reconcile(
        empty,
        deviceManifest([local("a.md", "h-local")]),
        coordinatorManifest(1, [remote("a.md", "h-remote", 1)]),
      );
      expect(plan.ops).toEqual([
        {
          kind: "conflict-copy",
          path: "a.md",
          winner: "remote",
          local: local("a.md", "h-local"),
          remote: remote("a.md", "h-remote", 1),
        },
      ]);
    });

    it("both edited to identical content -> converged, no op", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h2")]),
        coordinatorManifest(2, [remote("a.md", "h2", 2)]),
      );
      expect(plan.ops).toEqual([]);
    });

    it("local edit vs remote delete -> resurrect via a create push", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([local("a.md", "h2")]),
        coordinatorManifest(2, []),
      );
      expect(plan.ops).toEqual([{ kind: "push", path: "a.md", expectedBaseVersion: 0 }]);
    });

    it("local delete vs remote edit -> keep the remote edit via pull", () => {
      const plan = reconcile(
        coordinatorManifest(1, [remote("a.md", "h1", 1)]),
        deviceManifest([]),
        coordinatorManifest(2, [remote("a.md", "h2", 2)]),
      );
      expect(plan.ops).toEqual([{ kind: "pull", file: remote("a.md", "h2", 2) }]);
    });
  });

  it("emits ops sorted by path across many files", () => {
    const plan = reconcile(
      coordinatorManifest(2, [remote("b.md", "hb", 1), remote("c.md", "hc", 1)]),
      deviceManifest([local("a.md", "ha"), local("b.md", "hb")]),
      coordinatorManifest(3, [remote("b.md", "hb", 1), remote("c.md", "hc2", 2)]),
    );
    // a.md: new local -> push; b.md: unchanged -> skip; c.md: remote edit -> pull.
    expect(plan.ops).toEqual([
      { kind: "push", path: "a.md", expectedBaseVersion: 0 },
      { kind: "pull", file: remote("c.md", "hc2", 2) },
    ]);
  });
});

describe("conflictCopyName", () => {
  it("inserts a conflict tag before the extension, keeping the directory", () => {
    expect(conflictCopyName("notes/todo.md", "2026-07-05T12-34-56Z")).toBe(
      "notes/todo (conflict 2026-07-05T12-34-56Z).md",
    );
  });

  it("handles a root-level file", () => {
    expect(conflictCopyName("todo.md", "T")).toBe("todo (conflict T).md");
  });

  it("handles a file with no extension", () => {
    expect(conflictCopyName("dir/README", "T")).toBe("dir/README (conflict T)");
  });

  it("treats a dotfile as having no extension", () => {
    expect(conflictCopyName(".gitignore", "T")).toBe(".gitignore (conflict T)");
  });
});
