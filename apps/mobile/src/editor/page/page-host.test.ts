import { resolveObjectURL } from "node:buffer";

import { bytesFromBase64 } from "@repo/contract/bytes";
import type { HeldNote } from "@repo/contract/library/held-note";
import { paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { getEditorHostActions, getEditorHostIo, libraryTitles } from "@repo/editor/host-io";
import type { UnsentNote } from "@repo/contract/library/unsent-note";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { nextTask } from "../../test-support/async.test-utils";
import { installPageHost } from "./page-host";
import type { NoteState, PageProps, Settled } from "./page-host";

const NOTE = "0190a000-0000-7000-8000-0000000000a1";
const OTHER = "0190a000-0000-7000-8000-0000000000a2";

const HELD: HeldNote = {
  blocks: [{ block: paragraph("p1", "first"), section: "note" }],
  deleted: false,
  title: "Plans",
  version: 3,
};

const pageOver = () => {
  const states: NoteState[] = [];
  const answers: Settled[] = [];
  const opened: string[] = [];
  let targets = [{ id: NOTE, title: "Plans" }];
  let reads = 0;
  const keptByNative: (readonly [string, UnsentNote | null])[] = [];

  const first: PageProps = {
    createNote: async () => await Promise.resolve(OTHER),
    focus: false,
    itemId: NOTE,
    keepFile: async () => await Promise.resolve({ sha: "kept" }),
    keepUnsent: async (itemId, note) => {
      keptByNative.push([itemId, note]);
      await Promise.resolve();
    },
    linkTargets: async () => {
      reads += 1;

      return await Promise.resolve(targets);
    },
    moved: { ids: [], seq: 0 },
    noteStanding: async () => await Promise.resolve({ deleted: false, version: 4 }),
    noteState: (state) => {
      states.push(state);
    },
    offline: false,
    openItem: (itemId) => {
      opened.push(itemId);
    },
    readFile: async () => await Promise.resolve(null),
    readItem: async () => await Promise.resolve([paragraph("p1", "first")]),
    readNote: async () => await Promise.resolve(HELD),
    saveNote: async () => await Promise.resolve({ kind: "saved", version: 4 }),
    settle: 0,
    settled: (answer) => {
      answers.push(answer);
    },
    unsent: null,
  };

  const host = installPageHost(first);

  return {
    answers,
    first,
    host,
    keptByNative,
    opened,
    reads: () => reads,
    retitle: (next: typeof targets) => {
      targets = next;
    },
    states,
  };
};

const noteThat = (start: { readonly unsaved: boolean }) => {
  let { unsaved } = start;
  const holds = deferred<boolean>();
  const listeners = new Set<() => void>();

  const note: OpenNote = {
    agentEdited: vi.fn<OpenNote["agentEdited"]>(),
    agentEditing: vi.fn<OpenNote["agentEditing"]>(),
    holds: async () => await holds.promise,
    itemId: NOTE,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    unloadLoses: () => false,
    unsaved: () => unsaved,
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
  it("reads and saves the note whole through native, and reads where it stands as native says it moved", async () => {
    const { first, host } = pageOver();
    const { notes } = getEditorHostIo();
    const save = { baseVersion: 3, blocks: HELD.blocks, id: NOTE };
    const heard = vi.fn<(standing: { version: number; deleted: boolean }) => void>();
    const stop = notes.follow(NOTE, heard);

    await expect(notes.read(NOTE)).resolves.toStrictEqual(HELD);
    await expect(notes.save(save, false)).resolves.toStrictEqual({ kind: "saved", version: 4 });
    host.follow({ ...first, moved: { ids: [OTHER], seq: 1 } });
    await nextTask();
    expect(heard).not.toHaveBeenCalled();
    host.follow({ ...first, moved: { ids: [NOTE], seq: 2 } });
    await nextTask();
    expect(heard).toHaveBeenCalledExactlyOnceWith({ deleted: false, version: 4 });
    stop();
  });

  it("reaches the library through the actions native handed it last", async () => {
    const { first, host, opened } = pageOver();
    const io = getEditorHostIo();
    await expect(io.readItemBlocks(NOTE)).resolves.toStrictEqual([paragraph("p1", "first")]);

    host.follow({
      ...first,
      readItem: async () => await Promise.resolve(null),
      readNote: async () => await Promise.resolve(null),
    });

    await expect(io.readItemBlocks(NOTE)).resolves.toBeNull();
    await expect(io.notes.read(NOTE)).resolves.toBeNull();
    await expect(
      getEditorHostActions().items.createNote({ blocks: [], title: "Moved" }),
    ).resolves.toBe(OTHER);
    io.openItem(OTHER);
    expect(opened).toStrictEqual([OTHER]);
  });

  it("sends a pasted file as base64, and draws a file from one native read for the page's life", async () => {
    const { first, host } = pageOver();

    const native = {
      keepFile: async () => await Promise.resolve({ sha: "s" }),
      readFile: async () => await Promise.resolve({ base64: "AQID", mediaType: "audio/mp4" }),
    } satisfies Pick<PageProps, "keepFile" | "readFile">;

    const keepFile = vi.spyOn(native, "keepFile");
    const readFile = vi.spyOn(native, "readFile");
    host.follow({ ...first, ...native });
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

    let reads = 0;

    const readFile = async () => {
      reads += 1;

      if (reads === 1) {
        throw new Error("native answered nothing");
      }

      return await Promise.resolve(null);
    };

    host.follow({ ...first, readFile });

    await expect(getEditorHostIo().fileSrc("s")).rejects.toThrow(Error);
    await expect(getEditorHostIo().fileSrc("s")).rejects.toThrow(Error);
    expect(reads).toBe(2);
  });

  it("keeps a note's unsent typing through native, and reads first what native handed it", () => {
    const { first, host, keptByNative } = pageOver();
    const { notes } = getEditorHostIo();
    const typed = { baseBlocks: HELD.blocks, baseVersion: 3, blocks: HELD.blocks, title: "Plans" };

    expect(notes.unsent.read(NOTE)).toBeNull();
    host.follow({ ...first, itemId: OTHER, unsent: typed });
    expect(notes.unsent.read(OTHER)).toStrictEqual(typed);
    expect(notes.unsent.write(NOTE, typed)).toBe(true);
    expect(notes.unsent.read(NOTE)).toStrictEqual(typed);
    notes.unsent.write(NOTE, null);
    expect(notes.unsent.read(NOTE)).toBeNull();
    expect(keptByNative).toStrictEqual([
      [NOTE, typed],
      [NOTE, null],
    ]);
  });

  it("tells the note the moment native says there is no connection", () => {
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
