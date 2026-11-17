// The note page's host as the editor reaches it: the library through the actions native handed it
// last, the note's socket at the cloud's origin, and native's props followed after every render:
// whether there is a connection, which items moved, and a leave's ask, which the open note answers.

import { resolveObjectURL } from "node:buffer";

import { bytesFromBase64 } from "@repo/contract/bytes";
import { paragraph } from "@repo/contract/test-support/library-items";
import { getEditorHostActions, getEditorHostIo, libraryTitles } from "@repo/editor/host-io";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { nextTask } from "../../test-support/async";
import { installPageHost } from "./page-host";
import type { NoteState, PageProps, Settled } from "./page-host";

const NOTE = "0190a000-0000-7000-8000-0000000000a1";
const OTHER = "0190a000-0000-7000-8000-0000000000a2";

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

// an open note whose unsaved edit the suite turns, and whose leave it answers
const noteThat = (start: { readonly unsaved: boolean }) => {
  let { unsaved } = start;
  const holds = deferred<boolean>();
  const listeners = new Set<() => void>();
  const note: OpenNote = {
    holds: async () => await holds.promise,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unsaved: () => unsaved,
    unsent: () => false,
  };
  return {
    answer: holds.resolve,
    listeners,
    note,
    turn: (next: boolean) => {
      unsaved = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

describe("the note page's host", () => {
  it("dials the note's socket at the cloud's origin, on a ticket native fetched", async () => {
    pageOver();
    const { notes } = getEditorHostIo();

    expect(notes.socketOrigin).toBe("https://cell.test");
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

  it("sends a pasted file as base64, and draws a file from one native read for the page's life", async () => {
    const { first, host } = pageOver();
    const keepFile = vi.fn<PageProps["keepFile"]>(async () => await Promise.resolve({ sha: "s" }));
    const readFile = vi.fn<PageProps["readFile"]>(
      async () => await Promise.resolve({ base64: "AQID", mediaType: "audio/mp4" }),
    );
    host.follow({ ...first, keepFile, readFile });
    const io = getEditorHostIo();

    await expect(io.keepFile(Uint8Array.from([1, 2, 3]), "image/png")).resolves.toStrictEqual({
      sha: "s",
    });
    expect(keepFile).toHaveBeenCalledWith({ base64: "AQID", mediaType: "image/png" });
    const [src, again] = await Promise.all([io.fileSrc("s"), io.fileSrc("s")]);
    expect(again).toBe(src);
    await expect(io.fileSrc("s")).resolves.toBe(src);
    expect(readFile).toHaveBeenCalledOnce();
    const blob = resolveObjectURL(src);
    expect(blob?.type).toBe("audio/mp4");
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? [])).toStrictEqual(
      bytesFromBase64("AQID"),
    );
    expect(io.readFile).toBeNull();
  });

  it("refuses a file the phone holds no copy of, and reads it again when next asked", async () => {
    const { first, host } = pageOver();
    const readFile = vi
      .fn<PageProps["readFile"]>(async () => await Promise.resolve(null))
      .mockRejectedValueOnce(new Error("native answered nothing"));
    host.follow({ ...first, readFile });

    await expect(getEditorHostIo().fileSrc("s")).rejects.toThrow(Error);
    await expect(getEditorHostIo().fileSrc("s")).rejects.toThrow(Error);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("turns the note read-only the moment native says there is no connection", () => {
    const { first, host } = pageOver();
    const { notes } = getEditorHostIo();
    const heard = vi.fn<() => void>();
    notes.reach.subscribe(heard);

    host.follow({ ...first, offline: false });
    expect(heard).not.toHaveBeenCalled();
    host.follow({ ...first, offline: true });

    expect(notes.reach.get()).toBe(false);
    expect(heard).toHaveBeenCalledOnce();
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

  it("reads the titles again once it missed a signal or native could not say which items moved", async () => {
    const { first, host, reads } = pageOver();
    host.follow(first);
    await nextTask();

    host.follow({ ...first, moved: { ids: [NOTE], seq: 2 } });
    await nextTask();
    expect(reads()).toBe(2);

    host.follow({ ...first, moved: { ids: [NOTE], seq: 2 } });
    host.follow({ ...first, moved: { ids: null, seq: 3 } });
    await nextTask();
    expect(reads()).toBe(3);
  });

  it("tells native its note is being edited only while an edit may not be held, once each time that turns", () => {
    const { host, states } = pageOver();
    const open = noteThat({ unsaved: false });

    host.noteIs(null);
    host.noteIs(open.note);
    open.turn(false);
    open.turn(true);
    open.turn(true);
    open.turn(false);
    host.noteIs(null);

    expect(states).toStrictEqual(["none", "reading", "editing", "reading", "none"]);
    expect(open.listeners.size).toBe(0);
  });

  it("answers a leave's ask once the open note holds every edit made here", async () => {
    const { answers, first, host } = pageOver();
    host.follow({ ...first, settle: 1 });
    await nextTask();
    expect(answers).toStrictEqual([{ ask: 1, holds: true }]);

    const open = noteThat({ unsaved: true });
    host.noteIs(open.note);
    host.follow({ ...first, settle: 2 });
    await nextTask();
    expect(answers).toHaveLength(1);
    open.answer(false);
    await nextTask();

    expect(answers).toStrictEqual([
      { ask: 1, holds: true },
      { ask: 2, holds: false },
    ]);
  });
});
