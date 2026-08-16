import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteController, type NoteBuffer } from "../note-controller";

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

function harness(initial: string) {
  const buffer = new FakeBuffer(initial);
  const saves: string[] = [];
  let failNextSave: unknown = null;
  const conflicts = { count: 0 };
  const saveErrors: unknown[] = [];
  const controller = new NoteController({
    buffer,
    initialContent: initial,
    save: (content) => {
      if (failNextSave !== null) {
        const error = failNextSave;
        failNextSave = null;
        return Promise.reject(error);
      }
      saves.push(content);
      return Promise.resolve();
    },
    onConflict: () => {
      conflicts.count += 1;
    },
    onSaveError: (error) => {
      saveErrors.push(error);
    },
  });
  return {
    buffer,
    controller,
    saves,
    conflicts,
    saveErrors,
    failNext: (error: unknown) => {
      failNextSave = error;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the save debounce", () => {
  it("saves once after the quiet period", async () => {
    const h = harness("start\n");
    h.buffer.content = "start typed\n";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(799);
    expect(h.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saves).toEqual(["start typed\n"]);
  });

  it("restarts the quiet period on every keystroke", async () => {
    const h = harness("a");
    h.buffer.content = "ab";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(700);
    h.buffer.content = "abc";
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.saves).toEqual(["abc"]);
  });

  it("does not save when the buffer already matches the disk", async () => {
    const h = harness("same\n");
    h.controller.docChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.saves).toEqual([]);
  });

  it("flush saves immediately and cancels the pending timer", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.controller.docChanged();
    await h.controller.flush();
    expect(h.saves).toEqual(["xy"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.saves).toEqual(["xy"]);
  });

  it("reports a failed save and keeps the content dirty for a retry", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.failNext(new Error("disk full"));
    await h.controller.flush();
    expect(h.saveErrors).toHaveLength(1);
    expect(h.controller.isDirty()).toBe(true);
    await h.controller.flush();
    expect(h.saves).toEqual(["xy"]);
    expect(h.controller.isDirty()).toBe(false);
  });

  it("stops saving after dispose", async () => {
    const h = harness("x");
    h.buffer.content = "xy";
    h.controller.docChanged();
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.saves).toEqual([]);
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
    expect(h.saves).toEqual(["title EDITED\nbody\ntail APPENDED\n"]);
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
    expect(h.saves).toEqual(["a\nmine\nz\n"]);
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
    // A keystroke armed the timer, then undo returned the buffer to base.
    h.buffer.content = "v1 typed\n";
    h.controller.docChanged();
    h.buffer.content = "v1\n";
    h.controller.externalContent("v2\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.saves).toEqual([]);
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
