// @vitest-environment jsdom

// The item surface as a host mounts it: one connection and one editor per item, drawn only once
// the note's document has synced, over notes' objects held in memory behind a fake socket.

import { setTimeout as delay } from "node:timers/promises";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KEYS } from "platejs";
import type { SlateEditor } from "platejs";
import { YjsEditor } from "@slate-yjs/core";
import { Node } from "slate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";

import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

import { deferred } from "@repo/editor/deferred";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { openFindBar } from "@repo/editor/find-bar";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { getLiveEditor } from "@repo/editor/live-editor";
import { NOTES_ORIGIN, installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { docNodes, liveEditor } from "../test-support/live-notes";
import { noteServer } from "../test-support/note-server";
import type { NoteServer } from "../test-support/note-server";
import { HELD_BACK, ItemEditor, MISSING_ITEM, REFUSED_EDIT } from "./item-editor";
import type { OpenNote } from "./item-editor";

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190a000-0000-7000-8000-00000000000b";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// the notes' objects, each seeded with its blocks
const serve = (notes: Record<string, readonly LibraryBlock[]>): NoteServer => {
  const server = noteServer();
  for (const [itemId, blocks] of Object.entries(notes)) {
    seedDoc(
      server.note(itemId).doc,
      blocks.map((block) => ({ block, section: "note" as const })),
    );
  }
  return server;
};

const oneNote = (): NoteServer => serve({ [A]: [paragraph("a1", "A one")] });

const textsOf = (doc: Y.Doc): string[] => docNodes(doc).map((node) => Node.string(node));

const announced: (OpenNote | null)[] = [];

const Host = ({ itemId }: { itemId: string }) => (
  <ItemEditor
    itemId={itemId}
    onNote={(note) => {
      announced.push(note);
    }}
  />
);

const editable = (): Element | null => document.querySelector('[contenteditable="true"]');

const editorOf = (itemId: string): SlateEditor => {
  const editor = getLiveEditor(itemId);
  if (editor === null) {
    throw new Error("the surface drew no editor");
  }
  return editor;
};

const lastNote = (): OpenNote => {
  const note = announced.findLast((one) => one !== null);
  if (note === undefined || note === null) {
    throw new Error("no note followed the item");
  }
  return note;
};

const typeInto = (itemId: string, text: string): void => {
  act(() => {
    const editor = editorOf(itemId);
    editor.tf.insertText(text, { at: editor.api.end([0]) });
  });
};

beforeAll(() => {
  // jsdom lays nothing out, and a run of blocks measures its box as it draws
  /* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
  class ResizeObserverStub {
    observe = (): void => {};
    unobserve = (): void => {};
    disconnect = (): void => {};
  }
  /* oxlint-enable class-methods-use-this */
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

beforeEach(() => {
  announced.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("an item's surface", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it("writes an edit typed just before it moves to another item into the item it was typed in", async () => {
    const server = serve({ [A]: [paragraph("a1", "A one")], [B]: [paragraph("b1", "B one")] });
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editorA = editorOf(A);
    typeInto(A, "!");
    view.rerender(<Host itemId={B} />);
    await expect(screen.findByText("B one")).resolves.toBeDefined();
    expect(editorOf(B)).not.toBe(editorA);
    await waitFor(() => {
      expect(textsOf(server.note(A).doc)).toStrictEqual(["A one!"]);
    });
    expect(textsOf(server.note(B).doc)).toStrictEqual(["B one"]);
    expect(server.open(A)).toStrictEqual([]);
  });

  it("dials the note at the cloud the host names, never the page's own location", async () => {
    const server = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(location.origin).not.toBe(NOTES_ORIGIN);
    expect(server.sockets.map(({ url }) => url.split("?")[0])).toStrictEqual([
      `wss://notes.test/v1/notes/${A}`,
    ]);
  });

  it("keeps its note when the host draws it again", async () => {
    oneNote();
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const count = announced.length;
    view.rerender(<Host itemId={A} />);
    expect(announced).toHaveLength(count);
  });

  it("draws no editor until the note's document has synced", async () => {
    const ticket = deferred<string>();
    installFakeEditorHost({ socketTicket: async () => await ticket.promise });
    oneNote();
    render(<Host itemId={A} />);
    await act(async () => {
      await delay(0);
    });
    expect(screen.queryByText("A one")).toBeNull();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
    ticket.resolve("ticket");
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(editable()).not.toBeNull();
  });

  it("says an item with no note is not here, with no editor to type into", async () => {
    const server = noteServer();
    server.answer = "missing";
    render(<Host itemId={A} />);
    await expect(screen.findByText(MISSING_ITEM)).resolves.toBeDefined();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
  });

  it("lays in another device's edit as it lands", async () => {
    const server = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const elsewhere = liveEditor(server.note(A).doc, { kit: EDITOR_KIT });
    act(() => {
      elsewhere.tf.insertText(" and more", { at: elsewhere.api.end([0]) });
      YjsEditor.flushLocalChanges(elsewhere);
    });
    await expect(screen.findByText("A one and more")).resolves.toBeDefined();
  });

  it.each(["deleted", "full"] as const)(
    "reads a note held as %s, takes no edit and says why",
    async (held) => {
      const server = oneNote();
      server.note(A).greeting = held;
      render(<Host itemId={A} />);
      await expect(screen.findByText("A one")).resolves.toBeDefined();
      expect(screen.getByText(HELD_BACK[held])).toBeDefined();
      expect(editable()).toBeNull();
    },
  );

  it("says a paste too large for the note was refused, never that it needs a connection", async () => {
    const server = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const [socket] = server.open(A);
    if (socket === undefined) {
      throw new Error("an open socket");
    }
    server.answer = "hang";
    server.refuse(socket);
    await expect(screen.findByText(REFUSED_EDIT)).resolves.toBeDefined();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
    expect(editable()).toBeNull();
  });

  it("answers a leave once the note holds every edit made here", async () => {
    const server = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    typeInto(A, "!");
    await expect(lastNote().whenSaved()).resolves.toBe(true);
    expect(textsOf(server.note(A).doc)).toStrictEqual(["A one!"]);
  });

  it("answers a leave the note never confirms as unsaved once the surface closes", async () => {
    const server = oneNote();
    server.answersSaved = false;
    const view = render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    typeInto(A, "!");
    const saving = lastNote().whenSaved();
    view.unmount();
    await expect(saving).resolves.toBe(false);
    expect(announced.at(-1)).toBeNull();
  });
});

describe("an item's surface with no connection", () => {
  beforeAll(() => {
    // jsdom lays nothing out; the find bar's scroll to a match is a no-op there
    window.HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("reads the note but takes no edit, and says it needs a connection", async () => {
    const host = installFakeEditorHost();
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(editable()).not.toBeNull();
    act(() => {
      host.goOffline(true);
    });
    expect(editable()).toBeNull();
    expect(screen.getByText(NEEDS_CONNECTION)).toBeDefined();
    act(() => {
      host.goOffline(false);
    });
    expect(editable()).not.toBeNull();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
  });

  it("says a note in Deleted is there even with no connection", async () => {
    const host = installFakeEditorHost();
    const server = oneNote();
    server.note(A).greeting = "deleted";
    render(<Host itemId={A} />);
    await expect(screen.findByText(HELD_BACK.deleted)).resolves.toBeDefined();
    act(() => {
      host.goOffline(true);
    });
    expect(screen.getByText(HELD_BACK.deleted)).toBeDefined();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
  });

  it("says it needs a connection while the note cannot be reached", async () => {
    installFakeEditorHost({ offline: true });
    const server = oneNote();
    server.answer = "hang";
    render(<Host itemId={A} />);
    await expect(screen.findByText(NEEDS_CONNECTION)).resolves.toBeDefined();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
  });

  it("draws what the host holds of a note it cannot open, read-only, through its reconnect until it opens", async () => {
    const ticket = deferred<string>();
    const host = installFakeEditorHost({
      itemBlocks: (itemId) => (itemId === A ? [paragraph("a1", "A as held")] : null),
      offline: true,
      socketTicket: async () => await ticket.promise,
    });
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A as held")).resolves.toBeDefined();
    expect(screen.getByText(NEEDS_CONNECTION)).toBeDefined();
    expect(editable()).toBeNull();
    act(() => {
      host.goOffline(false);
    });
    await act(async () => {
      await delay(0);
    });
    expect(screen.getByText("A as held")).toBeDefined();
    ticket.resolve("ticket");
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(screen.queryByText("A as held")).toBeNull();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
    expect(editable()).not.toBeNull();
  });

  it("says only that it needs a connection when the host's read of the note fails", async () => {
    const itemBlocks = vi.fn<(itemId: string) => readonly LibraryBlock[] | null>(() => {
      throw new Error("no connection");
    });
    installFakeEditorHost({ itemBlocks, offline: true });
    const server = oneNote();
    server.answer = "hang";
    render(<Host itemId={A} />);
    await waitFor(() => {
      expect(itemBlocks).toHaveBeenCalledWith(A);
    });
    await act(async () => {
      await delay(0);
    });
    expect(screen.getByText(NEEDS_CONNECTION)).toBeDefined();
    expect(document.querySelector('[data-slate-editor="true"]')).toBeNull();
  });

  it("finds in the note but offers no replace", async () => {
    const host = installFakeEditorHost();
    oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      host.goOffline(true);
    });
    act(() => {
      openFindBar(editorOf(A), { replace: true });
    });
    expect(screen.getByRole("textbox", { name: "Find" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Replace with" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle replace" })).toBeNull();
  });

  it("draws no formatting toolbar on a touch screen", async () => {
    const host = installFakeEditorHost();
    oneNote();
    render(
      <EditorProfileProvider profile="touch">
        <Host itemId={A} />
      </EditorProfileProvider>,
    );
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    act(() => {
      host.goOffline(true);
    });
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    act(() => {
      host.goOffline(false);
    });
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeDefined();
  });
});

const SHA = "a".repeat(64);

const pastePicture = (target: Element): void => {
  fireEvent.paste(target, {
    clipboardData: {
      files: [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })],
      getData: () => "",
      types: ["Files"],
    },
  });
};

// the note open with a picture pasted into it, its bytes not yet kept
const pasteHeld = async () => {
  const kept = deferred<{ readonly sha: string }>();
  const host = installFakeEditorHost({ keepFile: async () => await kept.promise });
  const server = oneNote();
  const view = render(<Host itemId={A} />);
  await screen.findByText("A one");
  const editor = editorOf(A);
  const target = editable();
  if (target === null) {
    throw new Error("the surface drew no editor");
  }
  editor.tf.select(editor.api.end([0]));
  pastePicture(target);
  return { host, kept, server, view };
};

const storedShas = (server: NoteServer): unknown[] =>
  readBlocks(server.note(A).doc).flatMap(({ block }) => (block.type === "img" ? [block.sha] : []));

describe("a file still being kept in an open note", () => {
  // jsdom has no object URLs, and no isContentEditable, without which slate hands no paste on
  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:kept" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
      configurable: true,
      get(this: HTMLElement) {
        return this.closest('[contenteditable="true"]') !== null;
      },
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
  });

  it("holds a leave until the note holds the block that names it", async () => {
    const { kept, server } = await pasteHeld();
    let left = false;
    const leaving = (async () => {
      const saved = await lastNote().whenSaved();
      left = true;
      return saved;
    })();
    await act(async () => {
      await delay(0);
    });
    expect(left).toBe(false);

    kept.resolve({ sha: SHA });
    await act(async () => {
      await expect(leaving).resolves.toBe(true);
    });
    expect(storedShas(server)).toStrictEqual([SHA]);
  });

  it("adds no block for a file kept once the note took no more edits", async () => {
    const { host, kept, server } = await pasteHeld();
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
    await expect(lastNote().whenSaved()).resolves.toBe(true);
    expect(storedShas(server)).toStrictEqual([]);
  });

  it("adds no block for a file kept after the surface closed", async () => {
    const { kept, server, view } = await pasteHeld();
    view.unmount();
    kept.resolve({ sha: SHA });
    await act(async () => {
      await delay(0);
    });
    expect(storedShas(server)).toStrictEqual([]);
  });

  it("keeps no file pasted while there is no connection", async () => {
    const host = installFakeEditorHost();
    oneNote();
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

describe("a picker another device opened", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it("draws as its trigger alone, with no input to take the caret", async () => {
    const server = oneNote();
    render(<Host itemId={A} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const elsewhere = liveEditor(server.note(A).doc, { kit: EDITOR_KIT });
    act(() => {
      elsewhere.tf.insertNodes(
        { children: [{ text: "" }], type: KEYS.slashInput },
        { at: elsewhere.api.end([0]) },
      );
      YjsEditor.flushLocalChanges(elsewhere);
    });
    await waitFor(() => {
      expect(editorOf(A).api.some({ at: [], match: { type: KEYS.slashInput } })).toBe(true);
    });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(editable()?.textContent).toContain("A one/");
  });
});
