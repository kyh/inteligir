// Two open-note stores are two machines: publishing into one must not move the
// other, the module-level flush visits every registered pane, and per-note view
// state (the heading folds) is keyed by path rather than shared.

import { describe, expect, it, vi } from "vitest";

import { headingCollapseKeys, toggleHeadingCollapse } from "@repo/editor/heading-collapse";
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

  it("folding a heading in one pane leaves the other's folds and storage alone", () => {
    const written = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => written.get(key) ?? null,
      setItem: (key: string, value: string) => {
        written.set(key, value);
      },
      removeItem: (key: string) => {
        written.delete(key);
      },
    });
    try {
      toggleHeadingCollapse("notes/a.md", "1:Intro:0");

      expect([...headingCollapseKeys("notes/a.md")]).toEqual(["1:Intro:0"]);
      expect([...headingCollapseKeys("notes/b.md")]).toEqual([]);
      expect(written.size).toBe(1);
      const stored: unknown = JSON.parse([...written.values()][0] ?? "{}");
      expect(stored).toEqual({ "notes/a.md": ["1:Intro:0"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
