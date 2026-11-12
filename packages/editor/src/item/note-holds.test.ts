import { describe, expect, it, vi } from "vitest";

import { deferred } from "@repo/contract/deferred";

import type { NoteEdits } from "./note-connection";
import { noteHolds } from "./note-holds";
import type { LeavingNote } from "./note-holds";

type Status = ReturnType<LeavingNote["status"]>;

const LIVE: NoteEdits = { kind: "live" };
const OFFLINE: NoteEdits = { kind: "offline" };

const open = (edits: NoteEdits, unsent = false): Status => ({ edits, kind: "open", unsent });

// an open note whose status the suite moves, and whose save it answers
const noteAt = (start: Status) => {
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
    const { note, save } = noteAt(open(LIVE));
    const holding = noteHolds(note);
    save(true);
    await expect(holding).resolves.toBe(true);
  });

  it("holds all it can when it takes no edit, asking it nothing", async () => {
    const takesNone: Status[] = [
      open({ held: "deleted", kind: "held" }, true),
      open({ held: "full", kind: "held" }, true),
      open({ kind: "refused" }, true),
      { kind: "missing" },
      { kind: "opening", stalled: false },
      { kind: "opening", stalled: true },
    ];
    for (const status of takesNone) {
      const { note } = noteAt(status);
      await expect(noteHolds(note)).resolves.toBe(true);
      expect(note.whenSaved).not.toHaveBeenCalled();
    }
  });

  it("holds not an edit typed with no connection, and holds once nothing typed missed one", async () => {
    const unsent = noteAt(open(OFFLINE, true));
    await expect(noteHolds(unsent.note)).resolves.toBe(false);
    expect(unsent.note.whenSaved).not.toHaveBeenCalled();
    await expect(noteHolds(noteAt(open(OFFLINE)).note)).resolves.toBe(true);
  });

  it("stops waiting on a note whose socket goes down, and holds when nothing typed missed it", async () => {
    const { note, move } = noteAt(open(LIVE));
    const holding = noteHolds(note);
    move(open(OFFLINE));
    await expect(holding).resolves.toBe(true);
  });

  it("stops waiting on a note that refuses what it was sent, which no answer follows", async () => {
    const { note, move } = noteAt(open(LIVE));
    const holding = noteHolds(note);
    move(open({ kind: "refused" }));
    await expect(holding).resolves.toBe(true);
  });

  it("holds not when the note closes before it said it stored them", async () => {
    const { note, save } = noteAt(open(LIVE));
    const holding = noteHolds(note);
    save(false);
    await expect(holding).resolves.toBe(false);
  });
});
