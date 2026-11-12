// The note page's host as the editor reaches it: the library through the actions native handed it
// last, the note's socket at the cloud's origin, and native's props followed after every render:
// whether there is a connection, which items moved, and a leave's ask, answered by where the open
// note stands.

import { bytesFromBase64 } from "@repo/contract/bytes";
import { notePath } from "@repo/contract/library/library-socket";
import { paragraph } from "@repo/contract/test-support/library-items";
import { getEditorHostActions, getEditorHostIo, libraryTitles } from "@repo/editor/host-io";
import type { LeavingNote } from "@repo/editor/item/note-holds";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { nextTask } from "../../test-support/async";
import { installPageHost } from "./page-host";
import type { NoteState, PageProps, Settled } from "./page-host";

const NOTE = "0190a000-0000-7000-8000-0000000000a1";
const OTHER = "0190a000-0000-7000-8000-0000000000a2";

type Status = ReturnType<LeavingNote["status"]>;

const pageOver = () => {
  const states: NoteState[] = [];
  const answers: Settled[] = [];
  const opened: string[] = [];
  let targets = [{ id: NOTE, title: "Plans" }];
  let reads = 0;
  const first: PageProps = {
    cloudOrigin: "https://cell.test",
    createNote: async () => await Promise.resolve(OTHER),
    focus: false,
    itemId: NOTE,
    keepFile: async () => await Promise.resolve({ sha: "kept" }),
    linkTargets: async () => {
      reads += 1;
      return await Promise.resolve(targets);
    },
    moved: { ids: [], seq: 0 },
    noteState: (state) => {
      states.push(state);
    },
    offline: false,
    openItem: (itemId) => {
      opened.push(itemId);
    },
    readFile: async () => await Promise.resolve(null),
    readItem: async () => await Promise.resolve([paragraph("p1", "first")]),
    settle: 0,
    settled: (answer) => {
      answers.push(answer);
    },
    socketTicket: async () => await Promise.resolve("a-ticket"),
  };
  const host = installPageHost(first);
  return {
    answers,
    first,
    host,
    opened,
    reads: () => reads,
    retitle: (next: typeof targets) => {
      targets = next;
    },
    states,
  };
};

// an open note whose status the suite moves, and whose save it answers
const noteAt = (start: Status) => {
  let status = start;
  const saved = deferred<boolean>();
  const listeners = new Set<() => void>();
  const note: LeavingNote = {
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    whenSaved: async () => await saved.promise,
  };
  return {
    listeners,
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

const open = (live: boolean, unsent = false): Status => ({
  edits: { kind: live ? "live" : "offline" },
  kind: "open",
  unsent,
});

describe("the note page's host", () => {
  it("dials the note's socket at the cloud's origin, on a ticket native fetched", async () => {
    pageOver();
    const { notes } = getEditorHostIo();

    expect(notes.socketOrigin).toBe("https://cell.test");
    expect(notes.notePath(NOTE)).toBe(notePath(NOTE));
    await expect(notes.socketTicket()).resolves.toBe("a-ticket");
  });

  it("reaches the library through the actions native handed it last", async () => {
    const { first, host, opened } = pageOver();
    const io = getEditorHostIo();
    await expect(io.readItemBlocks(NOTE)).resolves.toStrictEqual([paragraph("p1", "first")]);

    host.follow({
      ...first,
      readItem: async () => await Promise.resolve(null),
      socketTicket: async () => await Promise.resolve("the next ticket"),
    });

    await expect(io.readItemBlocks(NOTE)).resolves.toBeNull();
    await expect(io.notes.socketTicket()).resolves.toBe("the next ticket");
    await expect(
      getEditorHostActions().items.createNote({ blocks: [], title: "Moved" }),
    ).resolves.toBe(OTHER);
    io.openItem(OTHER);
    expect(opened).toStrictEqual([OTHER]);
  });

  it("sends a pasted file as base64 and draws one native read as its bytes and type", async () => {
    const { first, host } = pageOver();
    const keepFile = vi.fn<PageProps["keepFile"]>(async () => await Promise.resolve({ sha: "s" }));
    host.follow({
      ...first,
      keepFile,
      readFile: async () => await Promise.resolve({ base64: "AQID", mediaType: "audio/mp4" }),
    });
    const io = getEditorHostIo();

    await expect(io.keepFile(Uint8Array.from([1, 2, 3]), "image/png")).resolves.toStrictEqual({
      sha: "s",
    });
    expect(keepFile).toHaveBeenCalledWith({ base64: "AQID", mediaType: "image/png" });
    const blob = await io.readFile("s");
    expect(blob.type).toBe("audio/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toStrictEqual(bytesFromBase64("AQID"));
    expect(io.savesFiles).toBe(false);
  });

  it("refuses a file the phone holds no copy of", async () => {
    pageOver();

    await expect(getEditorHostIo().readFile("s")).rejects.toThrow(Error);
  });

  it("turns the note read-only the moment native says there is no connection", () => {
    const { first, host } = pageOver();
    const { notes } = getEditorHostIo();
    const heard = vi.fn<() => void>();
    notes.onOfflineChange(heard);

    host.follow({ ...first, offline: false });
    expect(heard).not.toHaveBeenCalled();
    host.follow({ ...first, offline: true });

    expect(notes.offline()).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("names the items that moved, or any once it missed a signal or native could not say", () => {
    const { first, host } = pageOver();
    const heard: (ReadonlySet<string> | null)[] = [];
    getEditorHostIo().onItemsChanged((ids) => {
      heard.push(ids);
    });

    host.follow(first);
    host.follow({ ...first, moved: { ids: [OTHER], seq: 1 } });
    host.follow({ ...first, moved: { ids: [OTHER], seq: 1 } });
    host.follow({ ...first, moved: { ids: [OTHER], seq: 3 } });
    host.follow({ ...first, moved: { ids: null, seq: 4 } });

    expect(heard).toStrictEqual([new Set([OTHER]), null, null]);
  });

  it("reads the library's titles once it draws, and again when another item moves", async () => {
    const { first, host, reads, retitle } = pageOver();
    host.follow(first);
    await nextTask();
    expect(libraryTitles.getState().targets).toMatchObject([{ id: NOTE, title: "Plans" }]);

    host.follow({ ...first, moved: { ids: [NOTE], seq: 1 } });
    await nextTask();
    expect(reads()).toBe(1);

    retitle([{ id: OTHER, title: "Later" }]);
    host.follow({ ...first, moved: { ids: [OTHER], seq: 2 } });
    await nextTask();
    expect(reads()).toBe(2);
    expect(libraryTitles.getState().targets).toMatchObject([{ id: OTHER, title: "Later" }]);
  });

  it("tells native where the open note stands, once each time it moves", () => {
    const { host, states } = pageOver();
    const live = noteAt(open(true));

    host.noteIs(null);
    host.noteIs(live.note);
    live.move(open(true));
    live.move({ edits: { held: "deleted", kind: "held" }, kind: "open", unsent: false });
    host.noteIs(null);

    expect(states).toStrictEqual(["none", "editing", "reading", "none"]);
    expect(live.listeners.size).toBe(0);
  });

  it("counts an edit no connection carried yet as editing, and a note that took none as reading", () => {
    const { host, states } = pageOver();

    host.noteIs(noteAt(open(false, true)).note);
    host.noteIs(noteAt(open(false)).note);
    host.noteIs(noteAt({ kind: "opening", stalled: false }).note);

    expect(states).toStrictEqual(["editing", "reading", "none"]);
  });

  it("answers a leave's ask once the open note holds every edit made here", async () => {
    const { answers, first, host } = pageOver();
    host.follow({ ...first, settle: 1 });
    await nextTask();
    expect(answers).toStrictEqual([{ ask: 1, holds: true }]);

    const live = noteAt(open(true));
    host.noteIs(live.note);
    host.follow({ ...first, settle: 2 });
    await nextTask();
    expect(answers).toHaveLength(1);
    live.save(false);
    await nextTask();

    expect(answers).toStrictEqual([
      { ask: 1, holds: true },
      { ask: 2, holds: false },
    ]);
  });
});
