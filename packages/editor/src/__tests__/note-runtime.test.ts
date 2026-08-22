import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

import { type VaultIO } from "@repo/editor/vault-editor";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";

// Map-backed fake vault. Reads resolve from the map (reject when absent);
// `hangReads` makes reads never resolve, so a test can hold the open() chain
// open and observe the runtime BEFORE its first successful load.
class FakeVault implements VaultIO {
  files = new Map<string, string>();
  writes = 0;
  removes = 0;
  hangReads = false;

  read = (path: string): Promise<string> => {
    if (this.hangReads) return new Promise<string>(() => {});
    const v = this.files.get(path);
    return v === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(v);
  };
  write = (path: string, content: string): Promise<void> => {
    this.writes++;
    this.files.set(path, content);
    return Promise.resolve();
  };
  removeOutcome: DeleteVaultEntryResult = { outcome: "trashed" };
  remove = (path: string): Promise<DeleteVaultEntryResult> => {
    this.removes++;
    if (this.removeOutcome.outcome === "held") return Promise.resolve(this.removeOutcome);
    this.files.delete(path);
    return Promise.resolve(this.removeOutcome);
  };
}

// Fake timers leave microtasks untouched, so flushing the controller's async
// open/read/write chains is just draining the microtask queue a few hops.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// Fire the pending debounce timer, then let the write it kicks off land.
const runDebounce = async (): Promise<void> => {
  vi.advanceTimersByTime(600);
  await settle();
};

describe("createNoteRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces autosave: rapid edits coalesce into one write with the final bytes", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    runtime.edit("v2");
    runtime.edit("v3");
    expect(io.writes).toBe(0); // still debouncing — nothing written yet
    expect(vi.getTimerCount()).toBe(1); // one coalesced timer

    await runDebounce();
    expect(io.writes).toBe(1);
    expect(io.files.get("a.md")).toBe("v3");
  });

  it("edit with identical bytes is a no-op: not dirty, no scheduled write", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "same");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("same"); // identical to the loaded content
    expect(runtime.controller.getState().dirty).toBe(false);
    expect(vi.getTimerCount()).toBe(0); // no timer scheduled

    await runDebounce();
    expect(io.writes).toBe(0);
  });

  it("flush() mid-debounce writes immediately, clears the timer, and no second write fires", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    expect(vi.getTimerCount()).toBe(1);

    const clean = await runtime.flush();
    expect(clean).toBe(true);
    expect(io.writes).toBe(1);
    expect(io.files.get("a.md")).toBe("v1");
    expect(vi.getTimerCount()).toBe(0); // debounce cleared

    await runDebounce();
    expect(io.writes).toBe(1); // the pending timer never fired a second write
  });

  it("fires onVanished once when the file vanishes after a successful load", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", "root", io, {
      onVanished: (p) => vanished.push(p),
    });
    await settle();
    expect(runtime.controller.getState().path).toBe("a.md"); // loaded
    expect(vanished).toEqual([]);

    // File deleted out from under the open note; a vault-changed reload finds
    // it gone → controller emits path:null → vanish watcher fires.
    io.files.delete("a.md");
    runtime.controller.externalChange("root");
    await settle();
    expect(vanished).toEqual(["a.md"]);
  });

  it("does NOT fire onVanished for a transient path:null before the first successful load", async () => {
    const io = new FakeVault();
    io.hangReads = true; // open() never resolves → `opened` stays false, .then never runs
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", "root", io, {
      onVanished: (p) => vanished.push(p),
    });
    await settle();
    expect(runtime.controller.getState().path).toBe(null); // never loaded

    // A root switch emits an EMPTY (path:null) state. The opened gate must keep
    // the vanish watcher from treating it as the note disappearing.
    runtime.controller.externalChange("other-root");
    await settle();
    expect(vanished).toEqual([]);
  });

  it("dispose() clears a pending debounce timer — no write lands afterward", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    expect(vi.getTimerCount()).toBe(1);

    runtime.dispose();
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(0);
  });

  it("registerPreFlush: the hook runs at the top of flush(), and bytes it drains in land in the write", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    // Models the Rich editor's serialize flush: a keystroke still sitting in
    // the serialize debounce is drained into the buffer as an edit.
    runtime.registerPreFlush(() => runtime.edit("drained"));

    const clean = await runtime.flush();
    expect(clean).toBe(true);
    expect(io.files.get("a.md")).toBe("drained"); // the drained bytes were what flushed
    expect(vi.getTimerCount()).toBe(0); // the drained edit's debounce timer was cleared, not left behind
  });

  it("registerPreFlush: the hook runs before remove()", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    const order: string[] = [];
    runtime.registerPreFlush(() => order.push("preFlush"));
    const removeImpl = io.remove;
    io.remove = (path) => {
      order.push("remove");
      return removeImpl(path);
    };

    await runtime.remove();
    expect(order).toEqual(["preFlush", "remove"]);
  });

  it("registerPreFlush: last registration wins, and null clears it", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    let firstRuns = 0;
    let secondRuns = 0;
    runtime.registerPreFlush(() => firstRuns++);
    runtime.registerPreFlush(() => secondRuns++);
    await runtime.flush();
    expect(firstRuns).toBe(0); // replaced before it ever ran
    expect(secondRuns).toBe(1);

    runtime.registerPreFlush(null);
    await runtime.flush();
    expect(secondRuns).toBe(1); // cleared — nothing ran
  });

  it("remove() deletes the file and clears a pending debounce timer", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    expect(vi.getTimerCount()).toBe(1);

    await runtime.remove();
    expect(io.removes).toBe(1);
    expect(io.files.has("a.md")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(0); // the discarded edit never wrote
  });

  it("hands a held delete back to the caller instead of closing the note", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.removeOutcome = {
      outcome: "held",
      held: { deletions: 40, liveCount: 100, limit: 25, windowMs: 600_000, sample: ["a.md"] },
    };
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", "root", io, {
      onVanished: (path) => vanished.push(path),
    });
    await settle();

    expect(await runtime.remove()).toMatchObject({ outcome: "held" });
    await settle();
    // The file is still there, so the note is: nothing vanished, and the
    // provider gets the outcome to toast rather than a silent close.
    expect(vanished).toEqual([]);
    expect(runtime.controller.getState().path).toBe("a.md");
  });
});
