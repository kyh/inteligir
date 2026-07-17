import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";

import {
  SNAPSHOT_RETENTION,
  SnapshotStore,
  remapVaultPath,
  type SnapshotMeta,
} from "../snapshots/snapshot-store";
import type { FsAdapter } from "../lib/json-store";

const DIR = "/snaps";

const meta = (id: string, path: string, overrides?: Partial<SnapshotMeta>): SnapshotMeta => ({
  id,
  origin: "delegation",
  path,
  kind: "edit",
  ...overrides,
});

/** One in-memory file map backing both the JsonStore index and the content
 * files, plus direct access for tamper/orphan/migration setups. */
function makeStore(seed?: Map<string, string>) {
  const files = seed ?? new Map<string, string>();
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
  const store = new SnapshotStore({
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
          .map((p) => p.slice(dir.length + 1))
          .filter((name) => !name.includes("/")),
    },
    dir: DIR,
    indexPath: "/snapshots.json",
  });
  return { store, files };
}

afterEach(() => vi.restoreAllMocks());

describe("SnapshotStore", () => {
  it("capture + read round-trips the exact bytes, origin, kind and capture-time path", () => {
    const { store } = makeStore();
    store.capture(meta("d1", "notes/a.md"), "# A\n\n- [ ] task\n");
    expect(store.read("d1")).toEqual({
      ok: true,
      origin: "delegation",
      path: "notes/a.md",
      kind: "edit",
      content: "# A\n\n- [ ] task\n",
    });
  });

  it("round-trips CRLF line endings and a missing trailing newline byte-exactly", () => {
    const { store } = makeStore();
    const crlf = "# A\r\nline two\r\n";
    const noTrailing = "# B\nno trailing newline";
    store.capture(meta("c1", "a.md", { origin: "chat" }), crlf);
    store.capture(meta("c2", "b.md", { origin: "chat" }), noTrailing);
    expect(store.read("c1")).toMatchObject({ ok: true, content: crlf });
    expect(store.read("c2")).toMatchObject({ ok: true, content: noTrailing });
  });

  it("records a new-file write as kind 'create' (undo = delete it)", () => {
    const { store } = makeStore();
    store.capture(meta("c1", "fresh.md", { origin: "chat", kind: "create" }), "");
    expect(store.read("c1")).toEqual({
      ok: true,
      origin: "chat",
      path: "fresh.md",
      kind: "create",
      content: "",
    });
  });

  it("read of an unknown id reports no snapshot", () => {
    const { store } = makeStore();
    const result = store.read("nope");
    expect(result.ok).toBe(false);
  });

  it("refuses to hand back bytes that fail the recorded hash (tampered/torn file)", () => {
    const { store, files } = makeStore();
    store.capture(meta("d1", "a.md"), "original");
    files.set(`${DIR}/d1`, "tampered");
    const result = store.read("d1");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("corrupt");
  });

  it("reports a missing bytes file distinctly from a missing entry", () => {
    const { store, files } = makeStore();
    store.capture(meta("d1", "a.md"), "original");
    files.delete(`${DIR}/d1`);
    const result = store.read("d1");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("missing");
  });

  it("prune keeps the newest SNAPSHOT_RETENTION snapshots per origin and deletes older bytes", () => {
    const { store } = makeStore();
    // Distinct capturedAt per snapshot — real captures are never same-ms bursts.
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    const total = SNAPSHOT_RETENTION + 5;
    for (let i = 0; i < total; i++) store.capture(meta(`d${i}`, "a.md"), `content ${i}`);

    const pruned = store.prune();

    // The 5 oldest are gone — index entry and bytes both — and reported.
    expect(pruned.toSorted()).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    for (let i = 0; i < 5; i++) expect(store.read(`d${i}`).ok).toBe(false);
    // The newest SNAPSHOT_RETENTION survive intact.
    for (let i = 5; i < total; i++) {
      expect(store.read(`d${i}`)).toMatchObject({ ok: true, content: `content ${i}` });
    }
  });

  it("retention is PER ORIGIN — a chatty chat session can't evict delegation undo points", () => {
    const { store } = makeStore();
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    // Two OLD delegation snapshots, then a full window of newer chat captures.
    store.capture(meta("d1", "a.md"), "delegation one");
    store.capture(meta("d2", "b.md"), "delegation two");
    for (let i = 0; i < SNAPSHOT_RETENTION + 3; i++) {
      store.capture(meta(`c${i}`, "a.md", { origin: "chat" }), `chat ${i}`);
    }

    const pruned = store.prune();

    expect(store.read("d1")).toMatchObject({ ok: true, content: "delegation one" });
    expect(store.read("d2")).toMatchObject({ ok: true, content: "delegation two" });
    // Only the 3 oldest CHAT captures fell out.
    expect(pruned.toSorted()).toEqual(["c0", "c1", "c2"]);
    expect(store.read("c2").ok).toBe(false);
    expect(store.read("c3").ok).toBe(true);
  });

  it("prune sweeps orphan files in the content dir (crash leftovers)", () => {
    const { store, files } = makeStore();
    store.capture(meta("d1", "a.md"), "keep me");
    files.set(`${DIR}/orphan`, "bytes with no index entry");
    files.set(`${DIR}/d9.tmp`, "torn atomic write");

    store.prune();

    expect(files.has(`${DIR}/orphan`)).toBe(false);
    expect(files.has(`${DIR}/d9.tmp`)).toBe(false);
    expect(store.read("d1")).toMatchObject({ ok: true, content: "keep me" });
  });

  it("prune under the cap is a no-op for the index", () => {
    const { store } = makeStore();
    store.capture(meta("d1", "a.md"), "one");
    store.capture(meta("c1", "b.md", { origin: "chat" }), "two");
    expect(store.prune()).toEqual([]);
    expect(store.read("d1").ok).toBe(true);
    expect(store.read("c1").ok).toBe(true);
  });

  it("re-capturing the same id overwrites (idempotent, no duplicate entries)", () => {
    const { store } = makeStore();
    store.capture(meta("d1", "a.md"), "first");
    store.capture(meta("d1", "a.md"), "second");
    expect(store.read("d1")).toMatchObject({ ok: true, content: "second" });
    store.prune(); // must not treat the overwrite as an orphan
    expect(store.read("d1")).toMatchObject({ ok: true, content: "second" });
  });

  it("renamePath repoints exact-file and under-folder entries only", () => {
    const { store } = makeStore();
    store.capture(meta("c1", "notes/a.md", { origin: "chat" }), "one");
    store.capture(meta("c2", "notes/deep/b.md", { origin: "chat" }), "two");
    store.capture(meta("c3", "notes-other/c.md", { origin: "chat" }), "three");

    store.renamePath("notes/a.md", "archive/a.md");
    expect(store.read("c1")).toMatchObject({ ok: true, path: "archive/a.md" });

    store.renamePath("notes", "moved");
    expect(store.read("c2")).toMatchObject({ ok: true, path: "moved/deep/b.md" });
    // Prefix match is per-segment: "notes-other" is NOT under "notes".
    expect(store.read("c3")).toMatchObject({ ok: true, path: "notes-other/c.md" });
  });

  it("migrates a v1 (delegation-era) index: entries readable by delegation id, origin+kind filled", () => {
    const content = "# pre-run bytes\n";
    const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const seed = new Map<string, string>([
      [
        "/snapshots.json",
        JSON.stringify({
          version: 1,
          snapshots: [
            {
              delegationId: "legacy-1",
              path: "notes/legacy.md",
              snapshotFile: "legacy-1",
              capturedAt: 123,
              hash,
            },
          ],
        }),
      ],
      [`${DIR}/legacy-1`, content],
    ]);
    const { store } = makeStore(seed);
    expect(store.read("legacy-1")).toEqual({
      ok: true,
      origin: "delegation",
      path: "notes/legacy.md",
      kind: "edit",
      content,
    });
  });
});

describe("remapVaultPath", () => {
  it("remaps exact matches, folder children, and nothing else", () => {
    expect(remapVaultPath("a.md", "a.md", "b.md")).toBe("b.md");
    expect(remapVaultPath("dir/a.md", "dir", "moved")).toBe("moved/a.md");
    expect(remapVaultPath("dirx/a.md", "dir", "moved")).toBe("dirx/a.md");
    expect(remapVaultPath("other.md", "a.md", "b.md")).toBe("other.md");
  });
});

// Snapshot bytes are raw NOTE CONTENT — the default (real-fs) adapters must
// write both the bytes file and the index owner-only. Real fs in a temp dir.
const fileMode = (p: string) => nodeFs.statSync(p).mode & 0o777;

describe("SnapshotStore file modes (real fs)", () => {
  it("writes snapshot bytes and the index 0600", () => {
    const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "snapshots-mode-"));
    const dir = nodePath.join(root, "snapshots");
    const indexPath = nodePath.join(root, "snapshots.json");
    const store = new SnapshotStore({ dir, indexPath });
    store.capture(meta("d1", "a.md"), "note bytes");
    expect(fileMode(nodePath.join(dir, "d1"))).toBe(0o600);
    expect(fileMode(indexPath)).toBe(0o600);
    expect(store.read("d1")).toMatchObject({ ok: true, content: "note bytes" });
  });
});
