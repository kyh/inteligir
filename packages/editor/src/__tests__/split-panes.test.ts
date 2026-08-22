// Two open-note stores are two machines (#595): publishing into one must not
// move the other, and the module-level flush visits every registered pane.

import { describe, expect, it, vi } from "vitest";

import { flushOpenNote, registerOpenNoteStore } from "@repo/editor/note/open-note-flush";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}));

const EDITOR = (path: string, content: string, dirty = false) => ({
  root: "/vault",
  path,
  content,
  dirty,
  saving: false,
});

describe("split panes", () => {
  it("publishing into one pane leaves the other untouched", () => {
    const a = createOpenNoteStore();
    const b = createOpenNoteStore();
    a.publishOpenPath("notes/a.md");
    a.publishEditor(EDITOR("notes/a.md", "# A\n"));
    b.publishOpenPath("notes/b.md");
    b.publishEditor(EDITOR("notes/b.md", "# B\n"));

    expect(a.state().openPath).toBe("notes/a.md");
    expect(a.state().editor.content).toBe("# A\n");
    expect(b.state().openPath).toBe("notes/b.md");
    expect(b.state().editor.content).toBe("# B\n");

    a.publishOpenPath(null);
    expect(a.state().openDoc.kind).toBe("none");
    expect(b.state().openPath).toBe("notes/b.md");
  });

  it("history stacks are per pane", () => {
    const a = createOpenNoteStore();
    const b = createOpenNoteStore();
    a.publishOpenPath("one.md");
    a.publishOpenPath("two.md");
    b.publishOpenPath("three.md");
    expect(a.state().back).toEqual(["one.md"]);
    expect(b.state().back).toEqual([]);
  });

  it("flushOpenNote visits every registered pane and ANDs the verdicts", async () => {
    const a = createOpenNoteStore();
    const b = createOpenNoteStore();
    const flushA = vi.fn().mockResolvedValue(true);
    const flushB = vi.fn().mockResolvedValue(false);
    a.setFlush(flushA);
    b.setFlush(flushB);
    const offA = registerOpenNoteStore(a);
    const offB = registerOpenNoteStore(b);
    try {
      expect(await flushOpenNote()).toBe(false);
      expect(flushA).toHaveBeenCalledTimes(1);
      expect(flushB).toHaveBeenCalledTimes(1);
      flushB.mockResolvedValue(true);
      expect(await flushOpenNote()).toBe(true);
    } finally {
      offA();
      offB();
    }
  });

  it("an unregistered pane is no longer flushed", async () => {
    const a = createOpenNoteStore();
    const flushA = vi.fn().mockResolvedValue(true);
    a.setFlush(flushA);
    const off = registerOpenNoteStore(a);
    off();
    expect(await flushOpenNote()).toBe(true);
    expect(flushA).not.toHaveBeenCalled();
  });
});
