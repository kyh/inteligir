import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DelegationSnapshotStore,
  SNAPSHOT_RETENTION,
} from "../delegation/delegation-snapshots";
import type { FsAdapter } from "../lib/json-store";

const DIR = "/snaps";

/** One in-memory file map backing both the JsonStore index and the content
 * files, plus direct access for tamper/orphan setups. */
function makeStore() {
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
  const store = new DelegationSnapshotStore({
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

describe("DelegationSnapshotStore", () => {
  it("capture + read round-trips the exact bytes and the capture-time path", () => {
    const { store } = makeStore();
    store.capture("d1", "notes/a.md", "# A\n\n- [ ] task\n");
    expect(store.read("d1")).toEqual({
      ok: true,
      path: "notes/a.md",
      content: "# A\n\n- [ ] task\n",
    });
  });

  it("read of an unknown delegation reports no snapshot", () => {
    const { store } = makeStore();
    const result = store.read("nope");
    expect(result.ok).toBe(false);
  });

  it("refuses to hand back bytes that fail the recorded hash (tampered/torn file)", () => {
    const { store, files } = makeStore();
    store.capture("d1", "a.md", "original");
    files.set(`${DIR}/d1`, "tampered");
    const result = store.read("d1");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("corrupt");
  });

  it("reports a missing bytes file distinctly from a missing entry", () => {
    const { store, files } = makeStore();
    store.capture("d1", "a.md", "original");
    files.delete(`${DIR}/d1`);
    const result = store.read("d1");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("missing");
  });

  it("prune keeps the newest SNAPSHOT_RETENTION snapshots and deletes older bytes", () => {
    const { store } = makeStore();
    // Distinct capturedAt per snapshot — real captures are never same-ms bursts.
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    const total = SNAPSHOT_RETENTION + 5;
    for (let i = 0; i < total; i++) store.capture(`d${i}`, "a.md", `content ${i}`);

    store.prune();

    // The 5 oldest are gone — index entry and bytes both.
    for (let i = 0; i < 5; i++) expect(store.read(`d${i}`).ok).toBe(false);
    // The newest SNAPSHOT_RETENTION survive intact.
    for (let i = 5; i < total; i++) {
      expect(store.read(`d${i}`)).toMatchObject({ ok: true, content: `content ${i}` });
    }
  });

  it("prune sweeps orphan files in the content dir (crash leftovers)", () => {
    const { store, files } = makeStore();
    store.capture("d1", "a.md", "keep me");
    files.set(`${DIR}/orphan`, "bytes with no index entry");
    files.set(`${DIR}/d9.tmp`, "torn atomic write");

    store.prune();

    expect(files.has(`${DIR}/orphan`)).toBe(false);
    expect(files.has(`${DIR}/d9.tmp`)).toBe(false);
    expect(store.read("d1")).toMatchObject({ ok: true, content: "keep me" });
  });

  it("prune under the cap is a no-op for the index", () => {
    const { store } = makeStore();
    store.capture("d1", "a.md", "one");
    store.capture("d2", "b.md", "two");
    store.prune();
    expect(store.read("d1").ok).toBe(true);
    expect(store.read("d2").ok).toBe(true);
  });

  it("re-capturing the same delegation id overwrites (idempotent, no duplicate entries)", () => {
    const { store } = makeStore();
    store.capture("d1", "a.md", "first");
    store.capture("d1", "a.md", "second");
    expect(store.read("d1")).toMatchObject({ ok: true, content: "second" });
    store.prune(); // must not treat the overwrite as an orphan
    expect(store.read("d1")).toMatchObject({ ok: true, content: "second" });
  });
});
