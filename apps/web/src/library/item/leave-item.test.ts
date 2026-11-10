import { deferred } from "@repo/editor/deferred";
import type { NoteHeld } from "@repo/editor/item/note-connection";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";
import { describe, expect, it, vi } from "vitest";

import { leaveItem } from "./leave-item";

type Status =
  | { readonly kind: "opening" | "missing" }
  | { readonly kind: "open"; readonly live: boolean; readonly held: NoteHeld | null };

const open = (live: boolean, held: NoteHeld | null = null): Status => ({
  held,
  kind: "open",
  live,
});

// an open note whose status the suite moves, and whose save it answers
const noteAt = (start: Status, { unsent = false } = {}) => {
  let status = start;
  const saved = deferred<boolean>();
  const listeners = new Set<() => void>();
  const note = {
    status: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unsent: () => unsent,
    whenSaved: vi.fn<() => Promise<boolean>>(async () => await saved.promise),
  };
  return {
    move: (next: Status) => {
      status = next;
      for (const listener of listeners) {
        listener();
      }
    },
    note,
    save: saved.resolve,
  };
};

const STAYS = vi.fn<() => Promise<boolean>>(async () => false);

describe("leaving the open item", () => {
  it("goes, asking nothing, once the live note says it stored every edit", async () => {
    const { note, save } = noteAt(open(true));
    const ask = vi.fn<() => Promise<boolean>>();
    const leaving = leaveItem(note, ask);
    save(true);
    await expect(leaving).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("goes with no item open, and from a note that takes no edit", async () => {
    await expect(leaveItem(null, STAYS)).resolves.toBe(true);
    await expect(leaveItem(noteAt(open(true, "deleted")).note, STAYS)).resolves.toBe(true);
    await expect(leaveItem(noteAt({ kind: "missing" }).note, STAYS)).resolves.toBe(true);
  });

  it("asks before giving up an edit typed with no connection, and stays unless told to go", async () => {
    const { note } = noteAt(open(false), { unsent: true });
    const ask = vi.fn<(options: ConfirmOptions) => Promise<boolean>>(async () => false);
    await expect(leaveItem(note, ask)).resolves.toBe(false);
    expect(ask.mock.calls[0]?.[0].title).toBe("Leave without saving?");
    ask.mockResolvedValue(true);
    await expect(leaveItem(note, ask)).resolves.toBe(true);
    expect(note.whenSaved).not.toHaveBeenCalled();
  });

  it("stops waiting on a note whose socket goes down, and goes when nothing typed missed it", async () => {
    const { note, move } = noteAt(open(true));
    const leaving = leaveItem(note, STAYS);
    move(open(false));
    await expect(leaving).resolves.toBe(true);
  });

  it("asks when the note closes before it said it stored them", async () => {
    const { note, save } = noteAt(open(true));
    const ask = vi.fn<() => Promise<boolean>>(async () => false);
    const leaving = leaveItem(note, ask);
    save(false);
    await expect(leaving).resolves.toBe(false);
    expect(ask).toHaveBeenCalledOnce();
  });
});
