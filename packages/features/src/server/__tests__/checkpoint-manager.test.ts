import { describe, expect, it, vi } from "vitest";

import { CheckpointManager } from "../chat-undo/checkpoint-manager";
import { SnapshotStore } from "../snapshots/snapshot-store";
import type { FsAdapter } from "../lib/json-store";
import type { AgentEditCaptured } from "@repo/features/ipc-registry";

/** A snapshot store over an in-memory map — no ~/.inteligir writes in tests. */
function memorySnapshots(): SnapshotStore {
  const files = new Map<string, string>();
  const fs: FsAdapter = {
    read: (p) => files.get(p) ?? null,
    write: (p, content) => {
      files.set(p, content);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
  return new SnapshotStore({
    fs,
    files: {
      read: (p) => files.get(p) ?? null,
      write: (p, content) => {
        files.set(p, content);
      },
      remove: (p) => {
        files.delete(p);
      },
      list: (dir) =>
        [...files.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => p.slice(dir.length + 1)),
    },
    dir: "/snaps",
    indexPath: "/snapshots.json",
  });
}

const enoent = () => Object.assign(new Error("no such file"), { code: "ENOENT" });

/** An in-memory vault + manager rig mirroring the delegation-manager tests. */
function makeRig(initial: Record<string, string> = {}) {
  const vault = new Map<string, string>(Object.entries(initial));
  const writes: Array<{ rel: string; content: string }> = [];
  const trashed: string[] = [];
  const events: AgentEditCaptured[] = [];
  const snapshots = memorySnapshots();
  const mgr = new CheckpointManager({
    snapshots,
    readVault: (rel) => {
      const content = vault.get(rel);
      if (content === undefined) throw enoent();
      return content;
    },
    writeVault: (rel, content) => {
      writes.push({ rel, content });
      vault.set(rel, content);
    },
    trashVault: async (rel) => {
      trashed.push(rel);
      return vault.delete(rel);
    },
    onCaptured: (event) => events.push(event),
  });
  return { mgr, vault, writes, trashed, events, snapshots };
}

describe("CheckpointManager.capture", () => {
  it("copies the pre-write bytes of an existing file as kind 'edit' and notifies", () => {
    const bytes = "# A\r\nCRLF body, no trailing newline";
    const rig = makeRig({ "notes/a.md": bytes });
    rig.mgr.capture({ rel: "notes/a.md", tool: "edit" });

    expect(rig.events).toHaveLength(1);
    const event = rig.events[0];
    expect(event).toMatchObject({ path: "notes/a.md", kind: "edit" });
    const snap = event ? rig.snapshots.read(event.id) : { ok: false as const, error: "" };
    expect(snap).toMatchObject({ ok: true, origin: "chat", kind: "edit", content: bytes });
  });

  it("records a new-file write as kind 'create' (undo = delete it)", () => {
    const rig = makeRig();
    rig.mgr.capture({ rel: "fresh.md", tool: "write" });

    expect(rig.events).toHaveLength(1);
    expect(rig.events[0]).toMatchObject({ path: "fresh.md", kind: "create" });
    const id = rig.events[0]?.id ?? "";
    expect(rig.snapshots.read(id)).toMatchObject({ ok: true, kind: "create", content: "" });
  });

  it("captures nothing for an edit of a missing file (pi's edit will ENOENT — no write to protect)", () => {
    const rig = makeRig();
    rig.mgr.capture({ rel: "missing.md", tool: "edit" });
    expect(rig.events).toEqual([]);
  });

  it("throws on any non-ENOENT read failure — the gate blocks the write (fail-closed)", () => {
    const snapshots = memorySnapshots();
    const mgr = new CheckpointManager({
      snapshots,
      readVault: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(() => mgr.capture({ rel: "a.md", tool: "edit" })).toThrow("EACCES");
  });

  it("a notifier failure never blocks the write — the checkpoint is already on disk", () => {
    const snapshots = memorySnapshots();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vault = new Map([["a.md", "bytes"]]);
    const mgr = new CheckpointManager({
      snapshots,
      readVault: (rel) => {
        const c = vault.get(rel);
        if (c === undefined) throw enoent();
        return c;
      },
      onCaptured: () => {
        throw new Error("renderer went away");
      },
    });
    expect(() => mgr.capture({ rel: "a.md", tool: "edit" })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("CheckpointManager.restore", () => {
  it("writes the pre-write bytes back byte-exactly (CRLF, no trailing newline)", async () => {
    const bytes = "# A\r\nline\r\nno trailing newline";
    const rig = makeRig({ "notes/a.md": bytes });
    rig.mgr.capture({ rel: "notes/a.md", tool: "edit" });
    const id = rig.events[0]?.id ?? "";

    // The agent's write lands, then the user hits Undo.
    rig.vault.set("notes/a.md", "# A\nagent rewrote everything\n");
    const result = await rig.mgr.restore([id]);

    expect(result).toEqual({ ok: true });
    expect(rig.vault.get("notes/a.md")).toBe(bytes);
    expect(rig.writes).toEqual([{ rel: "notes/a.md", content: bytes }]);
  });

  it("is a no-op success (no write, no watcher churn) when the file already matches", async () => {
    const rig = makeRig({ "a.md": "same" });
    rig.mgr.capture({ rel: "a.md", tool: "edit" });
    const id = rig.events[0]?.id ?? "";

    expect(await rig.mgr.restore([id])).toEqual({ ok: true });
    expect(rig.writes).toEqual([]);
  });

  it("recreates a since-deleted file from the checkpoint", async () => {
    const rig = makeRig({ "a.md": "original" });
    rig.mgr.capture({ rel: "a.md", tool: "edit" });
    const id = rig.events[0]?.id ?? "";
    rig.vault.delete("a.md");

    expect(await rig.mgr.restore([id])).toEqual({ ok: true });
    expect(rig.vault.get("a.md")).toBe("original");
  });

  it("undoes a create by trashing the file (already-gone counts as done)", async () => {
    const rig = makeRig();
    rig.mgr.capture({ rel: "fresh.md", tool: "write" });
    const id = rig.events[0]?.id ?? "";
    rig.vault.set("fresh.md", "# agent-made note\n");

    expect(await rig.mgr.restore([id])).toEqual({ ok: true });
    expect(rig.trashed).toEqual(["fresh.md"]);
    expect(rig.vault.has("fresh.md")).toBe(false);

    // Second undo of the same create: the file is gone; still a success.
    expect(await rig.mgr.restore([id])).toEqual({ ok: true });
  });

  it("restores multiple files in one call and aggregates failures without giving up", async () => {
    const rig = makeRig({ "a.md": "A original", "b.md": "B original" });
    rig.mgr.capture({ rel: "a.md", tool: "edit" });
    rig.mgr.capture({ rel: "b.md", tool: "edit" });
    const [first, second] = rig.events;
    rig.vault.set("a.md", "A rewritten");
    rig.vault.set("b.md", "B rewritten");

    const result = await rig.mgr.restore(["unknown-id", first?.id ?? "", second?.id ?? ""]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("No saved copy");
    // The known checkpoints still restored.
    expect(rig.vault.get("a.md")).toBe("A original");
    expect(rig.vault.get("b.md")).toBe("B original");
  });

  it("refuses delegation-origin snapshots — their restore lives behind the guarded dock channel", async () => {
    const rig = makeRig({ "a.md": "current" });
    rig.snapshots.capture(
      { id: "delegation-1", origin: "delegation", path: "a.md", kind: "edit" },
      "pre-run bytes",
    );

    const result = await rig.mgr.restore(["delegation-1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("delegation");
    expect(rig.writes).toEqual([]);
  });
});
