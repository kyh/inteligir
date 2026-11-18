import { setTimeout as delay, setImmediate as nextTask } from "node:timers/promises";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Node } from "slate";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@repo/contract/deferred";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { openFindBar } from "@repo/editor/find-bar";
import { getLiveEditor } from "@repo/editor/live-editor";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host.test-utils";

import { memoryNotes } from "../test-support/memory-notes.test-utils";
import type { MemoryNotes } from "../test-support/memory-notes.test-utils";
import { ItemEditor, KEEP_MINE, MISSING_ITEM, NOTICES, SHOW_LATEST } from "./item-editor";
import type { OpenNote } from "./item-editor";
import { SAVE_PAUSE_MS } from "./note-save";
import { PASTE_MAX_BYTES, PASTE_REFUSED } from "./paste-cap";

const { toast } = await import("@repo/ui/components/sonner");

vi.spyOn(toast, "error");

vi.spyOn(toast, "info");

vi.spyOn(toast, "success");

vi.spyOn(toast, "warning");

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190a000-0000-7000-8000-00000000000b";

const p = (id: string, text: string) =>
  ({
    block: { children: [{ text }], id, type: "p" },
    section: "note",
  }) satisfies BodyBlock;

const serve = (
  seeded: Record<string, readonly BodyBlock[]>,
  options: Omit<FakeEditorHostOptions, "notes"> & { readonly deleted?: boolean } = {},
) => {
  const notes = memoryNotes();

  for (const [itemId, blocks] of Object.entries(seeded)) {
    notes.seed(itemId, blocks, { deleted: options.deleted ?? false, title: "Plans" });
  }

  return { ...installFakeEditorHost({ ...options, notes }), notes };
};

const oneNote = (options: Parameters<typeof serve>[1] = {}) =>
  serve({ [A]: [p("a1", "A one")] }, options);

const textsOf = (notes: MemoryNotes, itemId: string) =>
  (notes.note(itemId)?.blocks ?? []).map(({ block }) => Node.string(block));

const announced: (OpenNote | null)[] = [];

const Host = ({ itemId }: { itemId: string }) => (
  <ItemEditor
    itemId={itemId}
    onNote={(note) => {
      announced.push(note);
    }}
  />
);

const editable = () => document.querySelector('[contenteditable="true"]');

const editorOf = (itemId: string) => {
  const editor = getLiveEditor(itemId);

  if (editor === null) {
    throw new Error("the surface drew no editor");
  }

  return editor;
};

const lastNote = () => {
  const note = announced.findLast((one) => one !== null);

  if (note === undefined || note === null) {
    throw new Error("no note followed the item");
  }

  return note;
};

const typeInto = (itemId: string, text: string) => {
  act(() => {
    const editor = editorOf(itemId);
    editor.tf.insertText(text, { at: editor.api.end([0]) });
  });
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable="true"]') !== null;
    },
  });
});

beforeEach(() => {
  announced.length = 0;
  vi.clearAllMocks();
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

describe("an item's surface", () => {
  it("saves an edit typed just before it moves to another item into the item it was typed in", async () => {
    const { notes } = serve({ [A]: [p("a1", "A one")], [B]: [p("b1", "B one")] });
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editorA = editorOf(A);
    typeInto(A, "!");
    view.rerender(<Host itemId={B} />);
    await expect(screen.findByText("B one")).resolves.toBeDefined();
    expect(editorOf(B)).not.toBe(editorA);
    await waitFor(() => {
      expect(textsOf(notes, A)).toStrictEqual(["A one!"]);
    });
    expect(textsOf(notes, B)).toStrictEqual(["B one"]);
  });

  it("keeps its note when the host draws it again", async () => {
    oneNote();
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const count = announced.length;
    view.rerender(<Host itemId={A} />);
    expect(announced).toHaveLength(count);
  });

  it("says an item with no note is not here, with no editor to type into", async () => {
    serve({});
    render(<Host itemId={A} />);
    await expect(screen.findByText(MISSING_ITEM)).resolves.toBeDefined();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
  });

  it("lays in a body saved elsewhere as the library learns of it, the editor kept", async () => {
    const { notes } = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editor = editorOf(A);
    act(() => {
      notes.saveElsewhere(A, [p("a1", "A one and more")]);
    });
    await expect(screen.findByText("A one and more")).resolves.toBeDefined();
    expect(editorOf(A)).toBe(editor);
  });

  it("reads a note in Deleted, takes no edit and says why", async () => {
    oneNote({ deleted: true });
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(screen.getByText(NOTICES.deleted)).toBeDefined();
    expect(editable()).toBeNull();
    typeInto(A, " more");
    expect(Node.string(editorOf(A))).toBe("A one");
  });

  it("refuses a paste too large for a note whole, and says why", async () => {
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editor = editorOf(A);
    const target = editable();

    if (target === null) {
      throw new Error("the surface drew no editor");
    }

    const text = "x".repeat(PASTE_MAX_BYTES + 1);
    act(() => {
      editor.tf.select(editor.api.end([0]));
    });
    fireEvent.paste(target, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === "text/plain" ? text : ""),
        types: ["text/plain"],
      },
    });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(PASTE_REFUSED);
    expect(Node.string(editor)).toBe("A one");
    expect(lastNote().unsaved()).toBe(false);
  });

  it("answers a leave once the library holds every edit made here", async () => {
    const { notes } = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(lastNote().unsaved()).toBe(false);
    typeInto(A, "!");
    await waitFor(() => {
      expect(lastNote().unsaved()).toBe(true);
    });
    await expect(lastNote().holds()).resolves.toBe(true);
    expect(lastNote().unsaved()).toBe(false);
    expect(textsOf(notes, A)).toStrictEqual(["A one!"]);
  });

  it("lets a leave the library never answers go once the surface closes", async () => {
    const { notes } = oneNote();
    notes.gate("hold");
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    typeInto(A, "!");
    await waitFor(() => {
      expect(lastNote().unsaved()).toBe(true);
    });
    const leaving = lastNote().holds();
    view.unmount();
    await expect(leaving).resolves.toBe(true);
    expect(announced.at(-1)).toBeNull();
  });

  it("says the agent is editing the note while it does, and takes edits all the while", async () => {
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      lastNote().agentEditing("call-1");
    });
    expect(screen.getByText(NOTICES.agent)).toBeDefined();
    expect(editable()).not.toBeNull();
    act(() => {
      lastNote().agentEdited("call-1");
    });
    expect(screen.queryByText(NOTICES.agent)).toBeNull();
    expect(editable()).not.toBeNull();
  });
});

const SELECTION_READ_MS = 100;

const putCaret = async (text: string, offset: number) => {
  const shown = screen.getByText(text).firstChild;

  if (!(shown instanceof Text)) {
    throw new TypeError(`"${text}" is drawn as no text`);
  }

  getSelection()?.collapse(shown, offset);
  await act(async () => {
    await nextTask();
    vi.advanceTimersByTime(1);
  });
};

describe("the caret in an open item", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays where End moved it when the agent's edit lands before the editor reads it", async () => {
    const { notes } = serve({ [A]: [p("a1", "Line one."), p("a2", "Line two.")] });
    render(<Host itemId={A} />);
    await expect(screen.findByText("Line two.")).resolves.toBeDefined();
    const target = editable();

    if (!(target instanceof HTMLElement)) {
      throw new TypeError("the surface drew no editor");
    }

    target.tabIndex = 0;
    act(() => {
      target.focus();
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    act(() => {
      lastNote().agentEditing("call-1");
    });
    typeInto(A, " Typed.");
    act(() => {
      notes.saveElsewhere(A, [
        p("a0", "The agent's line."),
        p("a1", "Line one."),
        p("a2", "Line two."),
      ]);
    });
    notes.gate("hold");
    await act(async () => {
      lastNote().agentEdited("call-1");
      await nextTask();
      vi.advanceTimersByTime(SAVE_PAUSE_MS);
    });
    act(() => {
      vi.advanceTimersByTime(2 * SELECTION_READ_MS);
    });

    await putCaret("Line two.", 4);
    await putCaret("Line two.", "Line two.".length);
    notes.gate("answer");
    await act(async () => {
      notes.release();
      await nextTask();
    });
    expect(screen.getByText("The agent's line.")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(2 * SELECTION_READ_MS);
    });
    act(() => {
      editorOf(A).tf.insertText("!");
    });

    expect(editorOf(A).children.map((block) => Node.string(block))).toStrictEqual([
      "The agent's line.",
      "Line one. Typed.",
      "Line two.!",
    ]);
  });
});

const conflicted = async () => {
  const host = oneNote();
  render(<Host itemId={A} />);
  await expect(screen.findByText("A one")).resolves.toBeDefined();
  typeInto(A, ", mine");
  act(() => {
    host.notes.saveElsewhere(A, [p("a1", "A one, theirs")]);
  });
  await act(async () => {
    await expect(lastNote().holds()).resolves.toBe(false);
  });
  await expect(screen.findByText(NOTICES.conflict)).resolves.toBeDefined();

  return host;
};

describe("an item's surface over a block changed here and elsewhere apart", () => {
  it("takes no edit, and shows the latest in place of what was typed when asked", async () => {
    const { notes } = await conflicted();
    expect(editable()).toBeNull();
    expect(screen.getByText("A one, mine")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: SHOW_LATEST }));
    await expect(screen.findByText("A one, theirs")).resolves.toBeDefined();
    expect(screen.queryByText(NOTICES.conflict)).toBeNull();
    expect(editable()).not.toBeNull();
    expect(lastNote().unsaved()).toBe(false);
    expect(textsOf(notes, A)).toStrictEqual(["A one, theirs"]);
  });

  it("keeps what was typed as a new note, then shows the latest", async () => {
    const { calls } = await conflicted();
    fireEvent.click(screen.getByRole("button", { name: KEEP_MINE }));
    await expect(screen.findByText("A one, theirs")).resolves.toBeDefined();
    expect(calls).toMatchObject([
      {
        action: "createNote",
        args: [{ blocks: [{ children: [{ text: "A one, mine" }] }], title: "Plans (my version)" }],
      },
    ]);
  });

  it("stays on what was typed when the new note could not be made", async () => {
    await conflicted();
    installFakeEditorHost({
      createNote: async () => await Promise.reject(new Error("refused")),
      notes: memoryNotes(),
    });
    fireEvent.click(screen.getByRole("button", { name: KEEP_MINE }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledOnce();
    });
    expect(screen.getByText(NOTICES.conflict)).toBeDefined();
    expect(screen.getByText("A one, mine")).toBeDefined();
  });
});

describe("an item's surface with no connection", () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("reads the note but takes no edit, says it needs a connection, and saves once it is back", async () => {
    const { goOffline, notes } = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(editable()).not.toBeNull();
    act(() => {
      goOffline(true);
    });
    expect(editable()).toBeNull();
    expect(screen.getByText(NEEDS_CONNECTION)).toBeDefined();
    typeInto(A, " offline");
    expect(Node.string(editorOf(A))).toBe("A one");
    act(() => {
      goOffline(false);
    });
    expect(editable()).not.toBeNull();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
    typeInto(A, " online");
    await expect(lastNote().holds()).resolves.toBe(true);
    expect(textsOf(notes, A)).toStrictEqual(["A one online"]);
  });

  it("says a note in Deleted is there even with no connection", async () => {
    const { goOffline } = oneNote({ deleted: true });
    render(<Host itemId={A} />);
    await expect(screen.findByText(NOTICES.deleted)).resolves.toBeDefined();
    act(() => {
      goOffline(true);
    });
    expect(screen.getByText(NOTICES.deleted)).toBeDefined();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
  });

  it("says it needs a connection while the note cannot be read, and opens once it can", async () => {
    const { goOffline } = oneNote({ offline: true });
    render(<Host itemId={A} />);
    await expect(screen.findByText(NEEDS_CONNECTION)).resolves.toBeDefined();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
    act(() => {
      goOffline(false);
    });
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
    expect(editable()).not.toBeNull();
  });

  it("finds in the note but offers no replace", async () => {
    const { goOffline } = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      goOffline(true);
    });
    act(() => {
      openFindBar(editorOf(A), { replace: true });
    });
    expect(screen.getByRole("textbox", { name: "Find" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Replace with" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle replace" })).toBeNull();
  });

  it("draws no formatting toolbar on a touch screen", async () => {
    const { goOffline } = oneNote();
    render(
      <EditorProfileProvider profile="touch">
        <Host itemId={A} />
      </EditorProfileProvider>,
    );
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      goOffline(true);
    });
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    act(() => {
      goOffline(false);
    });
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeDefined();
  });
});

const SHA = "a".repeat(64);

const pastePicture = (target: Element) => {
  fireEvent.paste(target, {
    clipboardData: {
      files: [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })],
      getData: () => "",
      types: ["Files"],
    },
  });
};

const pasteHeld = async () => {
  const kept = deferred<{ readonly sha: string }>();
  const host = oneNote({ keepFile: async () => await kept.promise });
  const view = render(<Host itemId={A} />);
  await screen.findByText("A one");
  const editor = editorOf(A);
  const target = editable();

  if (target === null) {
    throw new Error("the surface drew no editor");
  }

  editor.tf.select(editor.api.end([0]));
  const heard = vi.fn<() => void>();
  lastNote().subscribe(heard);
  pastePicture(target);

  return { heard, host, kept, view };
};

const storedShas = (notes: MemoryNotes) =>
  (notes.note(A)?.blocks ?? []).flatMap(({ block }) => (block.type === "img" ? [block.sha] : []));

describe("a file still being kept in an open note", () => {
  it("holds a leave until the library holds the block that names it", async () => {
    const { heard, host, kept } = await pasteHeld();
    await waitFor(() => {
      expect(heard).toHaveBeenCalled();
    });
    expect(lastNote().unsaved()).toBe(true);
    let left = false;

    const leaving = (async () => {
      const holds = await lastNote().holds();
      left = true;

      return holds;
    })();

    await act(async () => {
      await delay(0);
    });
    expect(left).toBe(false);

    kept.resolve({ sha: SHA });
    await act(async () => {
      await expect(leaving).resolves.toBe(true);
    });
    expect(lastNote().unsaved()).toBe(false);
    expect(storedShas(host.notes)).toStrictEqual([SHA]);
  });

  it("lets a leave go without a file still being kept once the note takes no more edits", async () => {
    const { heard, host } = await pasteHeld();
    await waitFor(() => {
      expect(heard).toHaveBeenCalled();
    });
    const leaving = lastNote().holds();
    act(() => {
      host.goOffline(true);
    });
    await expect(leaving).resolves.toBe(true);
    expect(lastNote().unsaved()).toBe(false);
  });

  it("adds no block for a file kept once the note took no more edits", async () => {
    const { host, kept } = await pasteHeld();
    act(() => {
      host.goOffline(true);
    });
    kept.resolve({ sha: SHA });
    await act(async () => {
      await delay(0);
    });
    act(() => {
      host.goOffline(false);
    });
    await expect(lastNote().holds()).resolves.toBe(true);
    expect(storedShas(host.notes)).toStrictEqual([]);
  });

  it("adds no block for a file kept after the surface closed", async () => {
    const { host, kept, view } = await pasteHeld();
    view.unmount();
    kept.resolve({ sha: SHA });
    await act(async () => {
      await delay(0);
    });
    expect(storedShas(host.notes)).toStrictEqual([]);
  });

  it("keeps no file pasted while there is no connection", async () => {
    const host = oneNote();
    render(<Host itemId={A} />);
    await screen.findByText("A one");
    act(() => {
      host.goOffline(true);
    });
    const target = document.querySelector('[data-slate-editor="true"]');

    if (target === null) {
      throw new Error("the surface drew no editor");
    }

    pastePicture(target);
    await act(async () => {
      await delay(0);
    });
    expect(host.calls).toStrictEqual([]);
  });
});

describe("a picker in an open item", () => {
  it("takes the keys in the editor that opened it", async () => {
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      const editor = editorOf(A);
      editor.tf.select({ offset: 0, path: [0, 0] });
      editor.tf.insertText("/");
    });
    await expect(screen.findByRole("combobox")).resolves.toBeDefined();
  });
});
