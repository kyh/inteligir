import { describe, expect, it, vi } from "vitest";

import { focusNoteBody, registerNoteBodyFocus } from "@repo/editor/note-body-focus";

describe("handing the caret to a note's body", () => {
  it("focuses a mounted body at once", () => {
    const focus = vi.fn<() => void>();
    const off = registerNoteBodyFocus("a.md", focus);
    try {
      focusNoteBody("a.md");
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it("waits for a renamed note's body to mount under its new path", () => {
    const old = vi.fn<() => void>();
    const offOld = registerNoteBodyFocus("a.md", old);
    offOld();
    focusNoteBody("c.md");

    const carried = vi.fn<() => void>();
    const offCarried = registerNoteBodyFocus("c.md", carried);
    try {
      expect(old).not.toHaveBeenCalled();
      expect(carried).toHaveBeenCalledTimes(1);
    } finally {
      offCarried();
    }
  });

  it("drops a wait when another note's body mounts first", () => {
    focusNoteBody("c.md");
    const other = vi.fn<() => void>();
    const offOther = registerNoteBodyFocus("b.md", other);
    offOther();

    const late = vi.fn<() => void>();
    const offLate = registerNoteBodyFocus("c.md", late);
    try {
      expect(other).not.toHaveBeenCalled();
      expect(late).not.toHaveBeenCalled();
    } finally {
      offLate();
    }
  });
});
