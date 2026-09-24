import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import { EMPTY_EDITOR_STATE } from "@repo/editor/vault-editor";
import { FakeVault } from "./fake-vault";

// fake timers leave microtasks alone, so a few hops drain the controller's chains.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

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
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    runtime.edit("v2");
    runtime.edit("v3");
    expect(io.writes).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    await runDebounce();
    expect(io.writes).toBe(1);
    expect(io.files.get("a.md")).toBe("v3");
  });

  it("edit with identical bytes is a no-op: not dirty, no scheduled write", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "same");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("same");
    expect(runtime.controller.getState()).toMatchObject({ dirty: false });
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(0);
  });

  it("flush() mid-debounce writes immediately, clears the timer, and no second write fires", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    expect(vi.getTimerCount()).toBe(1);

    const clean = await runtime.flush();
    expect(clean).toBe(true);
    expect(io.writes).toBe(1);
    expect(io.files.get("a.md")).toBe("v1");
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(1);
  });

  it("fires onVanished once when the file vanishes after a successful load", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", io, {
      onVanished: (p) => {
        vanished.push(p);
      },
    });
    await settle();
    expect(runtime.controller.getState()).toMatchObject({ kind: "open", path: "a.md" });
    expect(vanished).toEqual([]);

    io.files.delete("a.md");
    runtime.controller.externalChange();
    await settle();
    expect(vanished).toEqual(["a.md"]);
  });

  it("does NOT fire onVanished for the closed state before the first successful load", async () => {
    const io = new FakeVault();
    io.hangReads = true;
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", io, {
      onVanished: (p) => {
        vanished.push(p);
      },
    });
    await settle();
    expect(runtime.controller.getState()).toEqual(EMPTY_EDITOR_STATE);

    runtime.controller.externalChange();
    await settle();
    expect(vanished).toEqual([]);
  });

  it("dispose() clears a pending debounce timer — no write lands afterward", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
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
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.registerPreFlush(() => {
      runtime.edit("drained");
    });

    const clean = await runtime.flush();
    expect(clean).toBe(true);
    expect(io.files.get("a.md")).toBe("drained");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("registerPreFlush: the hook runs before remove()", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    const order: string[] = [];
    runtime.registerPreFlush(() => {
      order.push("preFlush");
    });
    const removeImpl = io.remove;
    io.remove = async (path) => {
      order.push("remove");
      return await removeImpl(path);
    };

    await runtime.remove();
    expect(order).toEqual(["preFlush", "remove"]);
  });

  it("registerPreFlush: the controller drains it before taking bytes from disk, until dispose", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    let runs = 0;
    runtime.registerPreFlush(() => {
      runs += 1;
    });
    runtime.controller.externalChange();
    await settle();
    const drained = runs;
    expect(drained).toBeGreaterThan(0);

    runtime.dispose();
    runtime.controller.externalChange();
    await settle();
    expect(runs).toBe(drained);
  });

  it("registerPreFlush: last registration wins, and null clears it", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    let firstRuns = 0;
    let secondRuns = 0;
    runtime.registerPreFlush(() => {
      firstRuns += 1;
    });
    runtime.registerPreFlush(() => {
      secondRuns += 1;
    });
    await runtime.flush();
    expect(firstRuns).toBe(0);
    const drained = secondRuns;
    expect(drained).toBeGreaterThan(0);

    runtime.registerPreFlush(null);
    await runtime.flush();
    expect(secondRuns).toBe(drained);
  });

  it("retries a refused autosave on its own, backing off, until one lands", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const { write } = io;
    let refusals = 2;
    io.write = async (path, content) => {
      if (refusals > 0) {
        refusals -= 1;
        io.writes += 1;
        throw new Error("offline");
      }
      return await write(path, content);
    };
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    await runDebounce();
    expect(io.writes).toBe(1);
    expect(runtime.controller.getState()).toMatchObject({
      dirty: true,
      saveError: { kind: "refused", message: "offline" },
    });

    vi.advanceTimersByTime(1999);
    await settle();
    expect(io.writes).toBe(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(io.writes).toBe(2);

    vi.advanceTimersByTime(3999);
    await settle();
    expect(io.writes).toBe(2);
    vi.advanceTimersByTime(1);
    await settle();
    expect(io.writes).toBe(3);
    expect(io.files.get("a.md")).toBe("v1");
    expect(runtime.controller.getState()).toMatchObject({ dirty: false, saveError: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose() cancels a pending retry", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.write = async () => await Promise.reject(new Error("offline"));
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    await runDebounce();
    expect(vi.getTimerCount()).toBe(1);
    runtime.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a save whose file was deleted, and can write the file back", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    io.files.delete("a.md");
    runtime.edit("v1");
    await runDebounce();
    expect(runtime.controller.getState()).toMatchObject({
      dirty: true,
      path: "a.md",
      saveError: { kind: "vanished" },
    });
    expect(vi.getTimerCount()).toBe(0);

    await expect(runtime.recreate()).resolves.toBe(true);
    expect(io.files.get("a.md")).toBe("v1");
    expect(runtime.controller.getState()).toMatchObject({ dirty: false, saveError: null });
  });

  it("flush() writes a keystroke the surface held back while its write was in flight", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.manualWrite = true;
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();
    let held: string | null = null;
    runtime.registerPreFlush(() => {
      if (held !== null) {
        runtime.edit(held);
        held = null;
      }
    });

    runtime.edit("v1");
    const flushed = runtime.flush();
    await settle();
    held = "v2";
    io.manualWrite = false;
    io.pendingWrites[0]?.resolve();
    await expect(flushed).resolves.toBe(true);
    expect(io.writes).toBe(2);
    expect(io.files.get("a.md")).toBe("v2");
  });

  it("remove() deletes the file and clears a pending debounce timer", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const runtime = createNoteRuntime("a.md", io, { onVanished: () => {} });
    await settle();

    runtime.edit("v1");
    expect(vi.getTimerCount()).toBe(1);

    await runtime.remove();
    expect(io.removes).toBe(1);
    expect(io.files.has("a.md")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(0);
  });
});
