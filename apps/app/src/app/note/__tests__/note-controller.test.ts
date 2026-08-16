import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteController, type NoteBuffer, type SaveResult } from "../note-controller";

class FakeBuffer implements NoteBuffer {
  content: string;
  replacements: string[] = [];

  constructor(content: string) {
    this.content = content;
  }

  getDoc(): string {
    return this.content;
  }

  replaceDoc(next: string): void {
    this.content = next;
    this.replacements.push(next);
  }
}

interface SaveCall {
  content: string;
  base: string;
}

/** A scriptable save seam: by default every save applies; queue CAS refusals
 *  or errors per call, or park a call on a deferred to test in-flight races. */
function harness(initial: string) {
  const buffer = new FakeBuffer(initial);
  const calls: SaveCall[] = [];
  const applied: string[] = [];
  const planned: Array<
    | { kind: "apply" }
    | { kind: "cas"; current: string | null }
    | { kind: "error"; error: unknown }
    | { kind: "deferred"; promise: Promise<SaveResult> }
  > = [];
  const conflicts = { count: 0 };
  const saveErrors: unknown[] = [];
  const controller = new NoteController({
    buffer,
    initialContent: initial,
    save: (content, base) => {
      calls.push({ content, base });
      const plan = planned.shift() ?? { kind: "apply" };
      switch (plan.kind) {
        case "apply":
          applied.push(content);
          return Promise.resolve({ ok: true });
        case "cas":
          return Promise.resolve({
            ok: false,
            kind: "cas",
            current: plan.current === null ? null : { content: plan.current },
          });
        case "error":
          return Promise.reject(plan.error);
        case "deferred":
          return plan.promise;
      }
    },
    onConflict: () => {
      conflicts.count += 1;
    },
    onSaveError: (error) => {
      saveErrors.push(error);
    },
  });
  return { buffer, controller, calls, applied, planned, conflicts, saveErrors };
}

const noop = (): void => {};

function deferred(): { promise: Promise<SaveResult>; resolve: (result: SaveResult) => void } {
  let resolve: (result: SaveResult) => void = noop;
  const promise = new Promise<SaveResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the save debounce", () => {
  it("saves once after the quiet period, carrying the base it derived from", async () => {
    const h = harness("start\n");
    h.buffer.content = "start typed\n";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(799);
    expect(h.applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.applied).toEqual(["start typed\n"]);
    expect(h.calls).toEqual([{ content: "start typed\n", base: "start\n" }]);
  });

  it("restarts the quiet period on every keystroke", async () => {
    const h = harness("a");
    h.buffer.content = "ab";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(700);
    h.buffer.content = "abc";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.applied).toEqual(["abc"]);
  });

  it("does not save when the buffer already matches the disk", async () => {
    const h = harness("same\n");
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.applied).toEqual([]);
  });

  it("flush saves immediately and cancels the pending timer", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.controller.docChanged();
    await h.controller.flush();
    expect(h.applied).toEqual(["xy"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.applied).toEqual(["xy"]);
  });

  it("stops scheduling after dispose", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.controller.docChanged();
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.applied).toEqual([]);
  });
});

describe("flush durability (the rename gate)", () => {
  it("rejects on a failed save, reports it, and keeps the content dirty", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.planned.push({ kind: "error", error: new Error("disk full") });
    await expect(h.controller.flush()).rejects.toThrow("disk full");
    expect(h.saveErrors).toHaveLength(1);
    expect(h.controller.isDirty()).toBe(true);
    await h.controller.flush();
    expect(h.applied).toEqual(["xy"]);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("a second flush does not inherit the first flush's failure", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.planned.push({ kind: "error", error: new Error("boom") });
    const first = h.controller.flush();
    const second = h.controller.flush();
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(h.applied).toEqual(["xy"]);
  });

  it("completes an in-flight save even when dispose lands mid-flush", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    const gate = deferred();
    h.planned.push({ kind: "deferred", promise: gate.promise });
    const flushing = h.controller.flush();
    h.controller.dispose();
    gate.resolve({ ok: true });
    await flushing;
    expect(h.calls).toEqual([{ content: "xy", base: "x" }]);
    expect(h.controller.isDirty()).toBe(false);
  });
});

describe("compare-and-swap refusals", () => {
  it("merges a disjoint CAS refusal and retries once with the new base", async () => {
    const h = harness("title\nbody\ntail\n");
    h.buffer.content = "title EDITED\nbody\ntail\n";
    h.planned.push({ kind: "cas", current: "title\nbody\ntail APPENDED\n" });
    await h.controller.flush();
    expect(h.buffer.content).toBe("title EDITED\nbody\ntail APPENDED\n");
    expect(h.conflicts.count).toBe(0);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({
      content: "title EDITED\nbody\ntail APPENDED\n",
      base: "title\nbody\ntail APPENDED\n",
    });
    expect(h.applied).toEqual(["title EDITED\nbody\ntail APPENDED\n"]);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("prefers the buffer on an overlapping CAS refusal and reports the conflict", async () => {
    const h = harness("a\nshared\nz\n");
    h.buffer.content = "a\nmine\nz\n";
    h.planned.push({ kind: "cas", current: "a\ntheirs\nz\n" });
    await h.controller.flush();
    expect(h.buffer.content).toBe("a\nmine\nz\n");
    expect(h.conflicts.count).toBe(1);
    expect(h.applied).toEqual(["a\nmine\nz\n"]);
  });

  it("does not retry when the merge fully adopted the server's content", async () => {
    const h = harness("v1\n");
    // The buffer already holds what the server holds; the CAS just told us.
    h.buffer.content = "v2\n";
    h.planned.push({ kind: "cas", current: "v2\n" });
    await h.controller.flush();
    expect(h.calls).toHaveLength(1);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("rejects when the note vanished under the CAS", async () => {
    const h = harness("v1\n");
    h.buffer.content = "v2\n";
    h.planned.push({ kind: "cas", current: null });
    await expect(h.controller.flush()).rejects.toThrow("no longer exists");
    expect(h.saveErrors).toHaveLength(1);
  });

  it("rejects after a second CAS refusal instead of looping", async () => {
    const h = harness("base\n");
    h.buffer.content = "base mine\n";
    h.planned.push({ kind: "cas", current: "other one\n" });
    h.planned.push({ kind: "cas", current: "other two\n" });
    await expect(h.controller.flush()).rejects.toThrow("keeps changing");
    expect(h.saveErrors).toHaveLength(1);
    // The first merge's base still advanced; the buffer keeps the user's text.
    expect(h.buffer.content).toContain("mine");
  });
});

describe("in-flight base races", () => {
  it("discards a save resolution whose base advanced while in flight", async () => {
    const h = harness("v1\n");
    h.buffer.content = "v1 typed\n";
    const gate = deferred();
    h.planned.push({ kind: "deferred", promise: gate.promise });
    const flushing = h.controller.flush();
    // External truth lands mid-flight: clean-buffer? No — buffer is dirty, so
    // it merges; either way the base advances past what the save carried.
    h.controller.externalContent("v1\nexternal\n");
    const mergedBuffer = h.buffer.content;
    gate.resolve({ ok: true });
    await flushing;
    // The stale resolution must NOT have installed "v1 typed\n" as base:
    // the buffer still differs from the (external) base, so a save re-arms.
    expect(h.buffer.content).toBe(mergedBuffer);
    expect(h.controller.isDirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.applied).toContain(h.buffer.content);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("ignores a stale CAS refusal when newer external truth already reconciled", async () => {
    const h = harness("v1\n");
    h.buffer.content = "v1 typed\n";
    const gate = deferred();
    h.planned.push({ kind: "deferred", promise: gate.promise });
    const flushing = h.controller.flush();
    h.controller.externalContent("v2\n");
    gate.resolve({ ok: false, kind: "cas", current: { content: "stale server view\n" } });
    await flushing;
    // The stale refusal's content must not have been merged in.
    expect(h.buffer.content).not.toContain("stale server view");
  });
});

describe("the external-change path", () => {
  it("ignores the echo of its own save", async () => {
    const h = harness("v1\n");
    h.buffer.content = "v2\n";
    await h.controller.flush();
    h.controller.externalContent("v2\n");
    expect(h.buffer.replacements).toEqual([]);
  });

  it("adopts disk in place when the buffer is clean", () => {
    const h = harness("old\n");
    h.controller.externalContent("new from agent\n");
    expect(h.buffer.content).toBe("new from agent\n");
    expect(h.controller.isDirty()).toBe(false);
    expect(h.conflicts.count).toBe(0);
  });

  it("merges a disjoint external change into a dirty buffer and saves the merge", async () => {
    const h = harness("title\nbody\ntail\n");
    h.buffer.content = "title EDITED\nbody\ntail\n";
    h.controller.docChanged();
    h.controller.externalContent("title\nbody\ntail APPENDED\n");
    expect(h.buffer.content).toBe("title EDITED\nbody\ntail APPENDED\n");
    expect(h.conflicts.count).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.applied).toEqual(["title EDITED\nbody\ntail APPENDED\n"]);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("prefers the buffer and reports a conflict on overlapping edits", async () => {
    const h = harness("a\nshared\nz\n");
    h.buffer.content = "a\nmine\nz\n";
    h.controller.docChanged();
    h.controller.externalContent("a\ntheirs\nz\n");
    expect(h.buffer.content).toBe("a\nmine\nz\n");
    expect(h.conflicts.count).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.applied).toEqual(["a\nmine\nz\n"]);
  });

  it("treats a dirty buffer that already equals disk as saved", () => {
    const h = harness("v1\n");
    h.buffer.content = "v2\n";
    h.controller.externalContent("v2\n");
    expect(h.controller.isDirty()).toBe(false);
    expect(h.buffer.replacements).toEqual([]);
  });

  it("cancels a pending save when adopting disk into a clean buffer", async () => {
    const h = harness("v1\n");
    h.buffer.content = "v1 typed\n";
    h.controller.docChanged();
    h.buffer.content = "v1\n";
    h.controller.externalContent("v2\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.applied).toEqual([]);
    expect(h.buffer.content).toBe("v2\n");
  });

  it("uses the adopted disk as the merge base for the next external change", () => {
    const h = harness("v1\nmid\n");
    h.controller.externalContent("v2\nmid\n");
    h.buffer.content = "v2 mine\nmid\n";
    h.controller.externalContent("v2\nmid\ntail\n");
    expect(h.buffer.content).toBe("v2 mine\nmid\ntail\n");
    expect(h.conflicts.count).toBe(0);
  });
});
