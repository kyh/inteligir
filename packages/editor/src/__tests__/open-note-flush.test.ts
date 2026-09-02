import { describe, expect, it, vi } from "vitest";

import { flushOpenNote, registerOpenNoteStore } from "@repo/editor/note/open-note-flush";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}));

describe("flushing the open note", () => {
  it("answers true with nothing registered — there is no buffer to lose", async () => {
    expect(await flushOpenNote()).toBe(true);
  });

  it("awaits the registered store's flush and answers its verdict", async () => {
    const store = createOpenNoteStore();
    const flush = vi.fn().mockResolvedValue(false);
    store.setFlush(flush);
    const off = registerOpenNoteStore(store);
    try {
      expect(await flushOpenNote()).toBe(false);
      expect(flush).toHaveBeenCalledTimes(1);
      flush.mockResolvedValue(true);
      expect(await flushOpenNote()).toBe(true);
    } finally {
      off();
    }
  });

  it("treats a store with no live session as nothing to flush", async () => {
    const store = createOpenNoteStore();
    const off = registerOpenNoteStore(store);
    try {
      expect(await flushOpenNote()).toBe(true);
    } finally {
      off();
    }
  });

  it("stops flushing an unregistered store", async () => {
    const store = createOpenNoteStore();
    const flush = vi.fn().mockResolvedValue(true);
    store.setFlush(flush);
    registerOpenNoteStore(store)();
    expect(await flushOpenNote()).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });
});
