import { NodeApi } from "platejs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";

import type { Reach } from "../host-io";
import { memoryNotes } from "../test-support/memory-notes.test-utils";
import type { MemoryNotes } from "../test-support/memory-notes.test-utils";
import { NoteSaver, SAVE_MAX_WAIT_MS, SAVE_PAUSE_MS, takesNoEdit } from "./note-save";
import type { NoteBody } from "./note-save";

const A = "0190a000-0000-7000-8000-00000000000a";

const p = (id: string, text: string) =>
  ({
    block: { children: [{ text }], id, type: "p" },
    section: "note",
  }) satisfies BodyBlock;

const SEEDED = [p("a1", "one"), p("a2", "two")];

const textsOf = (blocks: readonly BodyBlock[] | undefined) =>
  (blocks ?? []).map(({ block }) => NodeApi.string(block));

class Editor implements NoteBody {
  blocks: readonly BodyBlock[];

  constructor(blocks: readonly BodyBlock[]) {
    this.blocks = blocks;
  }

  readonly mine = () => [...this.blocks] satisfies BodyBlock[];

  readonly lay = (blocks: readonly BodyBlock[]) => {
    this.blocks = blocks;

    return true;
  };
}

const fakeReach = (online: boolean) => {
  const listeners = new Set<() => void>();
  let now = online;

  const reach: Reach = {
    get: () => now,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    reach,
    set: (next: boolean) => {
      now = next;

      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const savers: NoteSaver[] = [];

const page = { document: new EventTarget(), visibility: "visible", window: new EventTarget() };

const goBehind = () => {
  page.visibility = "hidden";
  page.document.dispatchEvent(new Event("visibilitychange"));
};

const openView = (saver: NoteSaver) => {
  const view = saver.view();

  if (view.kind !== "open") {
    throw new Error(`the note is ${view.kind}`);
  }

  return view;
};

interface Opened {
  readonly notes: MemoryNotes;
  readonly saver: NoteSaver;
  readonly editor: Editor;
  readonly online: (next: boolean) => void;
  readonly type: (id: string, text: string) => void;
}

const open = async (options: { readonly online?: boolean; readonly deleted?: boolean } = {}) => {
  const notes = memoryNotes();
  notes.seed(A, SEEDED, { deleted: options.deleted ?? false, title: "Plans" });
  const reach = fakeReach(options.online ?? true);
  const saver = new NoteSaver(A, notes.host(reach.reach));
  savers.push(saver);
  saver.start();
  await vi.advanceTimersByTimeAsync(0);
  const editor = new Editor(openView(saver).blocks);
  saver.bind(editor);

  return {
    editor,
    notes,
    online: reach.set,
    saver,
    type: (id, text) => {
      editor.blocks = editor.blocks.map((one) => (one.block.id === id ? p(id, text) : one));
      saver.edited();
    },
  } satisfies Opened;
};

beforeEach(() => {
  vi.useFakeTimers();
  page.visibility = "visible";
  vi.stubGlobal("document", {
    addEventListener: page.document.addEventListener.bind(page.document),
    removeEventListener: page.document.removeEventListener.bind(page.document),
    get visibilityState() {
      return page.visibility;
    },
  });
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  for (const saver of savers.splice(0)) {
    saver.close();
  }

  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("an open note's saves", () => {
  it("saves a second after the last edit, and not before", async () => {
    const { notes, saver, type } = await open();
    type("a1", "one!");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS - 1);
    expect(notes.sent).toHaveLength(0);
    expect(saver.unsaved()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(notes.sent).toHaveLength(1);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one!", "two"]);
    expect(notes.note(A)?.version).toBe(2);
    expect(saver.unsaved()).toBe(false);
  });

  it("saves at most five seconds after the first unsaved edit while typing goes on", async () => {
    const { notes, type } = await open();

    for (let at = 0; at < SAVE_MAX_WAIT_MS; at += SAVE_PAUSE_MS / 2) {
      type("a1", `one ${String(at)}`);
      await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS / 2);
    }

    expect(notes.sent).toHaveLength(1);
    expect(textsOf(notes.sent[0]?.save.blocks)).toStrictEqual(["one 4500", "two"]);
  });

  it("keeps one save in flight, and sends what was typed meanwhile over the version it made", async () => {
    const { notes, type } = await open();
    notes.gate("hold");
    type("a1", "one!");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    type("a2", "two!");
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    expect(notes.sent).toHaveLength(1);
    notes.gate("answer");
    notes.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(notes.sent.map(({ save }) => save.baseVersion)).toStrictEqual([1, 2]);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one!", "two!"]);
    expect(notes.note(A)?.version).toBe(3);
  });

  it("merges a save over an older version with what was saved elsewhere, and saves the merge", async () => {
    const { editor, notes, saver, type } = await open();
    type("a1", "one, mine");
    notes.saveElsewhere(A, [p("a1", "one"), p("a2", "two, theirs")]);
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one, mine", "two, theirs"]);
    expect(notes.note(A)?.version).toBe(3);
    expect(textsOf(editor.blocks)).toStrictEqual(["one, mine", "two, theirs"]);
    expect(openView(saver).notice).toBeNull();
    expect(saver.unsaved()).toBe(false);
  });

  it("stops, read-only, on a block changed here and elsewhere apart, until the latest is shown", async () => {
    const { notes, saver, type } = await open();
    type("a1", "one, mine");
    notes.saveElsewhere(A, [p("a1", "one, theirs"), p("a2", "two")]);
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    const view = openView(saver);
    expect(view.notice).toBe("conflict");
    expect(takesNoEdit(view.notice)).toBe(true);
    expect(saver.unsaved()).toBe(true);
    expect(saver.mine()).toMatchObject({ title: "Plans" });
    expect(textsOf(saver.mine()?.blocks)).toStrictEqual(["one, mine", "two"]);
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one, theirs", "two"]);

    saver.showLatest();
    const latest = openView(saver);
    expect(latest.drawn).toBeGreaterThan(view.drawn);
    expect(textsOf(latest.blocks)).toStrictEqual(["one, theirs", "two"]);
    expect(latest.notice).toBeNull();
    expect(saver.unsaved()).toBe(false);
  });

  it("saves now as the agent edits the note, what it saves laid in while nothing is typed, until its edit ends", async () => {
    const { editor, notes, saver, type } = await open();
    type("a2", "two, mine");
    saver.agentEditing("call-1");
    expect(notes.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(openView(saver).notice).toBe("agent");
    expect(takesNoEdit(openView(saver).notice)).toBe(false);
    notes.saveElsewhere(A, [p("a1", "one, the agent's"), p("a2", "two, mine")]);
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    expect(openView(saver).notice).toBe("agent");
    expect(textsOf(editor.blocks)).toStrictEqual(["one, the agent's", "two, mine"]);

    saver.agentEdited("call-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(openView(saver).notice).toBeNull();
    expect(textsOf(editor.blocks)).toStrictEqual(["one, the agent's", "two, mine"]);
    expect(saver.unsaved()).toBe(false);
  });

  it("keeps every keystroke typed while the agent edits, saving none until its edit ends, then merged into it", async () => {
    const { editor, notes, saver, type } = await open();
    saver.agentEditing("call-1");
    const burst = " typed while the agent wrote";

    for (let typed = 1; typed <= burst.length; typed += 1) {
      type("a2", `two${burst.slice(0, typed)}`);
      await vi.advanceTimersByTimeAsync(50);

      if (typed === 10) {
        notes.saveElsewhere(A, [p("a1", "one, the agent's"), p("a2", "two")]);
      }
    }

    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    expect(notes.sent).toHaveLength(0);
    expect(saver.unsaved()).toBe(true);

    saver.agentEdited("call-1");
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS);
    const both = ["one, the agent's", `two${burst}`];
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(both);
    expect(textsOf(editor.blocks)).toStrictEqual(both);
    expect(openView(saver).notice).toBeNull();
    expect(saver.unsaved()).toBe(false);
  });

  it("takes edits with no connection, keeps them on the device, and saves them once it is back", async () => {
    const { notes, online, saver, type } = await open();
    type("a1", "one!");
    online(false);
    expect(openView(saver).notice).toBe("offline");
    expect(takesNoEdit(openView(saver).notice)).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    type("a1", "one!!");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(notes.sent).toHaveLength(0);
    expect(textsOf(notes.kept(A)?.blocks)).toStrictEqual(["one!!", "two"]);
    expect(saver.unloadLoses()).toBe(false);
    await expect(saver.holds()).resolves.toBe(false);
    online(true);
    expect(openView(saver).notice).toBeNull();
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one!!", "two"]);
    expect(notes.kept(A)).toBeNull();
  });

  it("reopens what a closed page kept, with no connection too, and merges it over what saved meanwhile", async () => {
    const first = await open();
    first.online(false);
    first.type("a1", "one, offline");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    first.saver.close();
    const reach = fakeReach(false);
    const again = new NoteSaver(A, first.notes.host(reach.reach));
    savers.push(again);
    again.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(textsOf(openView(again).blocks)).toStrictEqual(["one, offline", "two"]);
    await first.notes
      .host(fakeReach(true).reach)
      .save({ baseVersion: 1, blocks: [p("a1", "one"), p("a2", "two, elsewhere")], id: A }, false);
    const editor = new Editor(openView(again).blocks);
    again.bind(editor);
    reach.set(true);
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(textsOf(first.notes.note(A)?.blocks)).toStrictEqual(["one, offline", "two, elsewhere"]);
    expect(first.notes.kept(A)).toBeNull();
  });

  it("opens with no connection from what the host still reads, and stalls on nothing", async () => {
    const notes = memoryNotes();
    notes.seed(A, SEEDED);
    const reach = fakeReach(false);
    const saver = new NoteSaver(A, notes.host(reach.reach));
    savers.push(saver);
    saver.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.view()).toStrictEqual({ kind: "opening", stalled: true });
    reach.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(textsOf(openView(saver).blocks)).toStrictEqual(["one", "two"]);
  });

  it("tries a save the network failed again, and answers a leave meanwhile that it is not held", async () => {
    const { notes, saver, type } = await open();
    notes.gate("fail");
    type("a1", "one!");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(notes.sent).toHaveLength(1);
    await expect(saver.holds()).resolves.toBe(false);
    notes.gate("answer");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one!", "two"]);
    await expect(saver.holds()).resolves.toBe(true);
  });

  it("holds a note in Deleted read-only, and takes edits again once it is restored", async () => {
    const { notes, saver } = await open({ deleted: true });
    expect(openView(saver).notice).toBe("deleted");
    notes.setDeleted(A, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(openView(saver).notice).toBeNull();
  });

  it("lays a body saved elsewhere in place while nothing typed here is unsaved", async () => {
    const { editor, notes, saver } = await open();
    notes.saveElsewhere(A, [p("a1", "one"), p("a2", "two"), p("a3", "three")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(textsOf(editor.blocks)).toStrictEqual(["one", "two", "three"]);
    expect(openView(saver).drawn).toBe(1);
  });

  it("stops saving a note naming a file the library doesn't hold, still taking edits, until the file is gone", async () => {
    const { editor, notes, saver, type } = await open();
    notes.loseFileOf("a3");
    editor.blocks = [...editor.blocks, p("a3", "a file")];
    saver.edited();
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(notes.sent).toHaveLength(1);
    expect(openView(saver).notice).toBe("file-missing");
    expect(takesNoEdit("file-missing")).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 4);
    expect(notes.sent).toHaveLength(1);
    expect(saver.unsaved()).toBe(true);

    type("a1", "one!");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(notes.sent).toHaveLength(2);
    expect(openView(saver).notice).toBe("file-missing");
    editor.blocks = editor.blocks.filter(({ block }) => block.id !== "a3");
    saver.edited();
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(openView(saver).notice).toBeNull();
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["one!", "two"]);
    expect(saver.unsaved()).toBe(false);
  });

  it("stops saving past the most a note holds, still taking edits, until it is shorter", async () => {
    const { notes, saver, type } = await open();
    type("a1", "x".repeat(BODY_MAX_BYTES));
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(notes.sent).toHaveLength(0);
    expect(openView(saver).notice).toBe("full");
    expect(takesNoEdit("full")).toBe(false);
    type("a1", "short again");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(openView(saver).notice).toBeNull();
    expect(textsOf(notes.note(A)?.blocks)).toStrictEqual(["short again", "two"]);
  });
});

describe("an open note as its page goes", () => {
  it("saves at once as the page goes behind, to outlive the page", async () => {
    const { notes, type } = await open();
    type("a1", "one!");
    goBehind();
    expect(notes.sent).toMatchObject([{ outlives: true }]);
  });

  it("sends a note too long to outlive the page plainly, and says a close would lose it", async () => {
    const { notes, saver, type } = await open();
    type("a1", "x".repeat(61 * 1024));
    expect(saver.unloadLoses()).toBe(true);
    goBehind();
    expect(notes.sent).toMatchObject([{ outlives: false }]);
  });

  it("says a close would lose nothing while a small note's save can outlive it", async () => {
    const { saver, type } = await open();
    expect(saver.unloadLoses()).toBe(false);
    type("a1", "one!");
    expect(saver.unloadLoses()).toBe(false);
  });

  it("sends what is unsaved to outlive the page as it goes, over a plain save in flight", async () => {
    const { notes, type } = await open();
    notes.gate("hold");
    type("a1", "x".repeat(61 * 1024));
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    type("a1", "one, short");
    page.window.dispatchEvent(new Event("pagehide"));
    expect(notes.sent.map(({ outlives }) => outlives)).toStrictEqual([false, true]);
    expect(textsOf(notes.sent[1]?.save.blocks)).toStrictEqual(["one, short", "two"]);
  });
});
