import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import { FakeVault } from "./fake-vault";

// fake timers leave microtasks alone, so a few hops drain the controller's chains.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
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
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
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
    const runtime = createNoteRuntime("a.md", "root", io, { onVanished: () => {} });
    await settle();

    runtime.edit("same");
    expect(runtime.controller.getState().dirty).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

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
    expect(vi.getTimerCount()).toBe(0);

    await runDebounce();
    expect(io.writes).toBe(1);
  });

  it("fires onVanished once when the file vanishes after a successful load", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", "root", io, {
      onVanished: (p) => vanished.push(p),
    });
    await settle();
    expect(runtime.controller.getState().path).toBe("a.md");
    expect(vanished).toEqual([]);

    io.files.delete("a.md");
    runtime.controller.externalChange("root");
    await settle();
    expect(vanished).toEqual(["a.md"]);
  });

  it("does NOT fire onVanished for a transient path:null before the first successful load", async () => {
    const io = new FakeVault();
    io.hangReads = true;
    const vanished: string[] = [];
    const runtime = createNoteRuntime("a.md", "root", io, {
      onVanished: (p) => vanished.push(p),
    });
    await settle();
    expect(runtime.controller.getState().path).toBe(null);

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

    runtime.registerPreFlush(() => runtime.edit("drained"));

    const clean = await runtime.flush();
    expect(clean).toBe(true);
    expect(io.files.get("a.md")).toBe("drained");
    expect(vi.getTimerCount()).toBe(0);
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
    expect(firstRuns).toBe(0);
    expect(secondRuns).toBe(1);

    runtime.registerPreFlush(null);
    await runtime.flush();
    expect(secondRuns).toBe(1);
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
    expect(io.writes).toBe(0);
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
    expect(vanished).toEqual([]);
    expect(runtime.controller.getState().path).toBe("a.md");
  });
});
