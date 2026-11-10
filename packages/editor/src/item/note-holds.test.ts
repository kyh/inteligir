import { describe, expect, it, vi } from "vitest";

import { deferred } from "@repo/editor/deferred";

import type { NoteHeld } from "./note-connection";
import { noteHolds } from "./note-holds";

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

describe("whether the open note holds every edit made here", () => {
  it("holds once the live note says it stored every edit", async () => {
    const { note, save } = noteAt(open(true));
    const holding = noteHolds(note);
    save(true);
    await expect(holding).resolves.toBe(true);
  });

  it("holds all it can when it takes no edit, asking it nothing", async () => {
    const takesNone: Status[] = [
      open(true, "deleted"),
      open(false, "full"),
      { kind: "missing" },
      { kind: "opening" },
    ];
    for (const status of takesNone) {
      const { note } = noteAt(status, { unsent: true });
      await expect(noteHolds(note)).resolves.toBe(true);
      expect(note.whenSaved).not.toHaveBeenCalled();
    }
  });

  it("holds not an edit typed with no connection, and holds once nothing typed missed one", async () => {
    const unsent = noteAt(open(false), { unsent: true });
    await expect(noteHolds(unsent.note)).resolves.toBe(false);
    expect(unsent.note.whenSaved).not.toHaveBeenCalled();
    await expect(noteHolds(noteAt(open(false)).note)).resolves.toBe(true);
  });

  it("stops waiting on a note whose socket goes down, and holds when nothing typed missed it", async () => {
    const { note, move } = noteAt(open(true));
    const holding = noteHolds(note);
    move(open(false));
    await expect(holding).resolves.toBe(true);
  });

  it("holds not when the note closes before it said it stored them", async () => {
    const { note, save } = noteAt(open(true));
    const holding = noteHolds(note);
    save(false);
    await expect(holding).resolves.toBe(false);
  });
});
