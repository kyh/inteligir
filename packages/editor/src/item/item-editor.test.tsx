// @vitest-environment jsdom

// The item surface as a host mounts it: one editor and one session per item, drawn only once the
// item's blocks are in, over items held in memory whose reads and writes a case can hold.

import { setTimeout as delay } from "node:timers/promises";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SlateEditor } from "platejs";
import type * as PlateReact from "platejs/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { blockHash } from "@repo/contract/library/block-hash";
import { orderedBlocks } from "@repo/contract/library/block-ops";
import type { ItemState } from "@repo/contract/library/block-ops";
import { BLOCK_MAX_BYTES } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/refusal-text";
import { noteFields } from "@repo/contract/test-support/library-items";

import { deferred } from "@repo/editor/deferred";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { openFindBar } from "@repo/editor/find-bar";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { memoryItems } from "../test-support/memory-item";
import type { MemoryItems } from "../test-support/memory-item";
import { ItemEditor, MISSING_ITEM } from "./item-editor";
import { BLOCK_HELD_BACK, ITEM_UNREAD, ITEM_UNSAVED } from "./item-session";
import type { ItemSession, ItemSessionPorts, ItemStore } from "./item-session";

// every editor the surface makes, in the order it makes them, so a case can type into one
interface MadeEditors {
  readonly editors: SlateEditor[];
}
const made = vi.hoisted((): MadeEditors => ({ editors: [] }));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- the stub stands in for a few of platejs/react's exports alone, which the typed import() form refuses unless the whole module is stubbed
vi.mock("platejs/react", async (importOriginal) => {
  const actual = await importOriginal<typeof PlateReact>();
  return {
    ...actual,
    // with Plate's ids on as the app runs it: Plate turns its id plugin off under NODE_ENV=test
    usePlateEditor: (...[options, deps]: Parameters<typeof PlateReact.usePlateEditor>) => {
      const editor = actual.usePlateEditor({ ...options, nodeId: true }, deps);
      if (editor !== null && !made.editors.includes(editor)) {
        made.editors.push(editor);
      }
      return editor;
    },
  };
});

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190a000-0000-7000-8000-00000000000b";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const itemOf = (title: string, ...blocks: LibraryBlock[]): ItemState => ({
  blocks: new Map(
    blocks.map((block, index) => [
      block.id,
      { block, hash: blockHash(block), ord: `a${String(index)}`, section: "note" as const },
    ]),
  ),
  fields: noteFields({ title }),
});

const textsOf = (state: ItemState | undefined): string[] =>
  orderedBlocks(state?.blocks ?? new Map()).map(({ block }) =>
    block.children.map((child) => ("text" in child ? child.text : "")).join(""),
  );

// a pause that never comes: a case writes by flushing
const portsOver = (store: ItemStore): ItemSessionPorts => ({
  after: () => () => {},
  notifyOverlap: () => {},
  store,
});

const sessions: (ItemSession | null)[] = [];

const Host = ({
  itemId,
  ports,
  offline,
}: {
  itemId: string;
  ports: ItemSessionPorts;
  offline?: boolean;
}) => (
  <ItemEditor
    itemId={itemId}
    ports={ports}
    offline={offline}
    onSession={(session) => {
      sessions.push(session);
    }}
  />
);

const editable = (): Element | null => document.querySelector('[contenteditable="true"]');

const lastSession = (): ItemSession => {
  const session = sessions.findLast((one) => one !== null);
  if (session === undefined || session === null) {
    throw new Error("no session followed the item");
  }
  return session;
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
  installFakeEditorHost();
});

afterEach(() => {
  sessions.length = 0;
  made.editors.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("an item's surface", () => {
  it("keeps each item's own blocks when it moves to another item mid-write", async () => {
    const memory = memoryItems([
      [A, itemOf("A", paragraph("a1", "A one"), paragraph("a2", "A two"))],
      [B, itemOf("B", paragraph("b1", "B one"), paragraph("b2", "B two"))],
    ]);
    const ports = portsOver(memory.store);
    const view = render(<Host itemId={A} ports={ports} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editorA = made.editors.at(-1);
    const sessionA = lastSession();
    const write = deferred<null>();
    memory.held.write = write;
    act(() => {
      editorA?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    });
    const writing = sessionA.flush();
    view.rerender(<Host itemId={B} ports={ports} />);
    await expect(screen.findByText("B one")).resolves.toBeDefined();
    expect(made.editors.at(-1)).not.toBe(editorA);
    write.resolve(null);
    await writing;
    await waitFor(() => {
      expect(textsOf(memory.item(A))).toStrictEqual(["A one!", "A two"]);
    });
    expect(textsOf(memory.item(B))).toStrictEqual(["B one", "B two"]);
  });

  it("keeps its session when the host hands it the same ports anew", async () => {
    const { store } = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const view = render(<Host itemId={A} ports={portsOver(store)} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const announced = sessions.length;
    view.rerender(<Host itemId={A} ports={portsOver(store)} />);
    expect(sessions).toHaveLength(announced);
  });

  it("draws no editor until the item's blocks are in it", async () => {
    const { held, store } = memoryItems([[A, itemOf("A", paragraph("a1", "the item's text"))]]);
    const read = deferred<null>();
    held.read = read;
    render(<Host itemId={A} ports={portsOver(store)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(editable()).toBeNull();
    read.resolve(null);
    await expect(screen.findByText("the item's text")).resolves.toBeDefined();
    expect(editable()).not.toBeNull();
  });

  it("says beside the text why an edit is not saved, until it is", async () => {
    const { store } = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    render(<Host itemId={A} ports={portsOver(store)} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editor = made.editors.at(-1);
    const session = lastSession();
    act(() => {
      editor?.tf.insertText("y".repeat(BLOCK_MAX_BYTES), { at: { offset: 5, path: [0, 0] } });
    });
    await act(async () => {
      await session.flush();
    });
    expect(screen.getByRole("alert").textContent).toBe(BLOCK_HELD_BACK);
    act(() => {
      editor?.undo();
    });
    await act(async () => {
      await session.flush();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a first read that failed, and offers to read the item again", async () => {
    const { held, store } = memoryItems([[A, itemOf("A", paragraph("a1", "the item's text"))]]);
    const read = deferred<null>();
    held.read = read;
    render(<Host itemId={A} ports={portsOver(store)} />);
    read.reject(new Error("the page gave up waiting for the phone"));
    await expect(screen.findByText(ITEM_UNREAD)).resolves.toBeDefined();
    expect(editable()).toBeNull();
    held.read = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await expect(screen.findByText("the item's text")).resolves.toBeDefined();
    expect(screen.queryByText(ITEM_UNREAD)).toBeNull();
  });

  it("says an item this device does not hold is not here, with no editor to type into", async () => {
    const { store } = memoryItems();
    render(<Host itemId={A} ports={portsOver(store)} />);
    await expect(screen.findByText(MISSING_ITEM)).resolves.toBeDefined();
    expect(editable()).toBeNull();
  });
});

// the store as a host hands it over, refusing every write while the connection is gone
const connectionOver = (memory: MemoryItems) => {
  const connection = { up: true };
  const store: ItemStore = {
    item: memory.store.item,
    onChange: memory.store.onChange,
    write: async (itemId, input) => {
      if (!connection.up) {
        throw new Error("Failed to fetch");
      }
      return await memory.store.write(itemId, input);
    },
  };
  return { connection, ports: portsOver(store) };
};

describe("an item's surface with no connection", () => {
  beforeAll(() => {
    // jsdom lays nothing out; the find bar's scroll to a match is a no-op there
    window.HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("reads the item but takes no edit, and says it needs a connection", async () => {
    const { store } = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const view = render(<Host itemId={A} ports={portsOver(store)} offline />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(editable()).toBeNull();
    expect(screen.getByText(NEEDS_CONNECTION)).toBeDefined();
    view.rerender(<Host itemId={A} ports={portsOver(store)} />);
    expect(editable()).not.toBeNull();
    expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
  });

  it("writes an edit typed before the connection went as soon as it is back", async () => {
    const memory = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const { connection, ports } = connectionOver(memory);
    const view = render(<Host itemId={A} ports={ports} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const session = lastSession();
    act(() => {
      made.editors.at(-1)?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    });
    connection.up = false;
    view.rerender(<Host itemId={A} ports={ports} offline />);
    await act(async () => {
      await session.flush();
    });
    expect(screen.getByRole("alert").textContent).toBe(ITEM_UNSAVED);
    expect(textsOf(memory.item(A))).toStrictEqual(["A one"]);

    connection.up = true;
    view.rerender(<Host itemId={A} ports={ports} />);
    await waitFor(() => {
      expect(textsOf(memory.item(A))).toStrictEqual(["A one!"]);
    });
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
  });

  it("finds in the item but offers no replace", async () => {
    const { store } = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    render(<Host itemId={A} ports={portsOver(store)} offline />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editor = made.editors.at(-1);
    if (editor === undefined) {
      throw new Error("the surface drew no editor");
    }
    act(() => {
      openFindBar(editor, { replace: true });
    });
    expect(screen.getByRole("textbox", { name: "Find" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Replace with" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle replace" })).toBeNull();
  });

  it("draws no formatting toolbar on a touch screen", async () => {
    const { store } = memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const surface = (offline: boolean) => (
      <EditorProfileProvider profile="touch">
        <Host itemId={A} ports={portsOver(store)} offline={offline} />
      </EditorProfileProvider>
    );
    const view = render(surface(true));
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
    view.rerender(surface(false));
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeDefined();
  });
});

const SHA = "a".repeat(64);

const pastePicture = (target: HTMLElement): void => {
  fireEvent.paste(target, {
    clipboardData: {
      files: [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })],
      getData: () => "",
      types: ["Files"],
    },
  });
};

// the item open with a picture pasted into it, its bytes not yet kept
const pasteHeld = async (memory: MemoryItems) => {
  const kept = deferred<{ readonly sha: string }>();
  installFakeEditorHost({ keepFile: async () => await kept.promise });
  const view = render(<Host itemId={A} ports={portsOver(memory.store)} />);
  await screen.findByText("A one");
  const editor = made.editors.at(-1);
  const target = editable();
  if (editor === undefined || !(target instanceof HTMLElement)) {
    throw new Error("the surface drew no editor");
  }
  editor.tf.select(editor.api.end([0]));
  pastePicture(target);
  return { held: memory.held, kept, view };
};

const storedShas = (memory: MemoryItems): readonly unknown[] =>
  [...(memory.item(A)?.blocks.values() ?? [])].flatMap(({ block }) =>
    block.type === "img" ? [block.sha] : [],
  );

const oneItem = (): MemoryItems => memoryItems([[A, itemOf("A", paragraph("a1", "A one"))]]);

describe("a file still being kept in an open item", () => {
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
    installFakeEditorHost();
  });

  it("counts as unsaved, and a leave waits to write the block that names it", async () => {
    const memory = oneItem();
    const { kept } = await pasteHeld(memory);
    const session = lastSession();
    expect(session.status()).toMatchObject({ kind: "open", unsaved: true });

    let left = false;
    const leaving = (async () => {
      await session.flush();
      left = true;
    })();
    await act(async () => {
      await delay(0);
    });
    expect(left).toBe(false);

    kept.resolve({ sha: SHA });
    await act(async () => {
      await leaving;
    });

    expect(storedShas(memory)).toStrictEqual([SHA]);
  });

  it("lets what was typed go at once, ahead of the block a leave waits for", async () => {
    const memory = oneItem();
    const { kept } = await pasteHeld(memory);
    const session = lastSession();
    made.editors.at(-1)?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });

    const leaving = session.flush();
    await act(async () => {
      await delay(0);
    });
    expect(textsOf(memory.item(A))).toContain("A one!");
    expect(storedShas(memory)).toStrictEqual([]);

    kept.resolve({ sha: SHA });
    await act(async () => {
      await leaving;
    });
    expect(storedShas(memory)).toStrictEqual([SHA]);
  });

  it("writes its block once kept, with no pause and no leave to ask", async () => {
    const memory = oneItem();
    const { kept } = await pasteHeld(memory);

    kept.resolve({ sha: SHA });

    await waitFor(() => {
      expect(storedShas(memory)).toStrictEqual([SHA]);
    });
    expect(lastSession().status()).toMatchObject({ kind: "open", unsaved: false });
  });

  it("writes its block when it is kept under a leave's first write", async () => {
    const memory = oneItem();
    const { held, kept } = await pasteHeld(memory);
    const session = lastSession();
    made.editors.at(-1)?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    const firstWrite = deferred<null>();
    held.write = firstWrite;

    const leaving = session.flush();
    kept.resolve({ sha: SHA });
    await act(async () => {
      await delay(0);
    });
    firstWrite.resolve(null);
    await act(async () => {
      await leaving;
    });

    expect(textsOf(memory.item(A))).toContain("A one!");
    expect(storedShas(memory)).toStrictEqual([SHA]);
  });

  it("holds a leave, and counts as unsaved, until the write behind it is done", async () => {
    const memory = oneItem();
    const { held, kept } = await pasteHeld(memory);
    const session = lastSession();

    let left = false;
    const leaving = (async () => {
      await session.flush();
      left = true;
    })();
    await act(async () => {
      await delay(0);
    });
    const keptWrite = deferred<null>();
    held.write = keptWrite;
    kept.resolve({ sha: SHA });
    await act(async () => {
      await delay(0);
    });
    expect(left).toBe(false);
    expect(session.status()).toMatchObject({ kind: "open", unsaved: true });

    keptWrite.resolve(null);
    await act(async () => {
      await leaving;
    });
    expect(storedShas(memory)).toStrictEqual([SHA]);
    expect(session.status()).toMatchObject({ kind: "open", unsaved: false });
  });

  it("is written when the surface closed before it was kept", async () => {
    const memory = oneItem();
    const { kept, view } = await pasteHeld(memory);

    view.unmount();
    kept.resolve({ sha: SHA });

    await waitFor(() => {
      expect(storedShas(memory)).toStrictEqual([SHA]);
    });
  });

  it("keeps no file pasted while there is no connection", async () => {
    const host = installFakeEditorHost();
    render(<Host itemId={A} ports={portsOver(oneItem().store)} offline />);
    await screen.findByText("A one");
    const target = document.querySelector('[data-slate-editor="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new TypeError("the surface drew no editor");
    }
    pastePicture(target);
    await act(async () => {
      await delay(0);
    });
    expect(host.calls).toStrictEqual([]);
  });
});
