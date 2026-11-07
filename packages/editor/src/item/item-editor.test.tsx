// @vitest-environment jsdom

// The item surface as a host mounts it: one editor and one session per item, drawn only once the
// item's blocks are in, over a store held in memory whose reads and writes a case can hold.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SlateEditor } from "platejs";
import type * as PlateReact from "platejs/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState } from "@repo/notes/library/block-ops";
import { BLOCK_MAX_BYTES } from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { noteFields } from "@repo/notes/test-support/library-items";

import { deferred } from "@repo/editor/deferred";
import type { Deferred } from "@repo/editor/deferred";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { ItemEditor, MISSING_ITEM } from "./item-editor";
import { BLOCK_HELD_BACK, ITEM_UNREAD } from "./item-session";
import type { HeldItem, ItemSession, ItemSessionPorts, ItemStore } from "./item-session";

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
    usePlateEditor: (...args: Parameters<typeof PlateReact.usePlateEditor>) => {
      const editor = actual.usePlateEditor(...args);
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

const heldOf = (state: ItemState): HeldItem => ({
  blocks: orderedBlocks(state.blocks),
  bodyHeld: true,
  fields: state.fields,
});

const textsOf = (state: ItemState | undefined): string[] =>
  orderedBlocks(state?.blocks ?? new Map()).map(({ block }) =>
    block.children.map((child) => ("text" in child ? child.text : "")).join(""),
  );

// what holds the store's next read or write until the case lets it go
interface HeldCalls {
  read: Deferred<null> | null;
  write: Deferred<null> | null;
}

// the items a device holds, in memory, its next read or write held while a gate is set
const memoryStore = (items: Map<string, ItemState>) => {
  const held: HeldCalls = { read: null, write: null };
  const store: ItemStore = {
    item: async (itemId) => {
      await held.read?.promise;
      const state = items.get(itemId);
      return state === undefined ? null : heldOf(state);
    },
    onChange: () => () => {},
    write: async (itemId, input) => {
      const waiting = held.write;
      held.write = null;
      await waiting?.promise;
      const state = items.get(itemId);
      if (state === undefined) {
        return { kind: "missing" };
      }
      const landed = applyOps(state, input.ops);
      if (landed.kind !== "applied") {
        return { item: heldOf(state), kind: "changed" };
      }
      items.set(itemId, landed.state);
      return { kind: "queued" };
    },
  };
  return { held, store };
};

const portsOver = (store: ItemStore): ItemSessionPorts => ({
  after: () => () => {},
  notifyOverlap: () => {},
  store,
});

const sessions: (ItemSession | null)[] = [];

const Host = ({ itemId, ports }: { itemId: string; ports: ItemSessionPorts }) => (
  <ItemEditor
    itemId={itemId}
    ports={ports}
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
    const items = new Map([
      [A, itemOf("A", paragraph("a1", "A one"), paragraph("a2", "A two"))],
      [B, itemOf("B", paragraph("b1", "B one"), paragraph("b2", "B two"))],
    ]);
    const { held, store } = memoryStore(items);
    const ports = portsOver(store);
    const view = render(<Host itemId={A} ports={ports} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const editorA = made.editors.at(-1);
    const sessionA = lastSession();
    const write = deferred<null>();
    held.write = write;
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
      expect(textsOf(items.get(A))).toStrictEqual(["A one!", "A two"]);
    });
    expect(textsOf(items.get(B))).toStrictEqual(["B one", "B two"]);
  });

  it("keeps its session when the host hands it the same ports anew", async () => {
    const items = new Map([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const { store } = memoryStore(items);
    const view = render(<Host itemId={A} ports={portsOver(store)} />);
    await expect(screen.findByText("A one")).resolves.toBeDefined();
    const announced = sessions.length;
    view.rerender(<Host itemId={A} ports={portsOver(store)} />);
    expect(sessions).toHaveLength(announced);
  });

  it("draws no editor until the item's blocks are in it", async () => {
    const items = new Map([[A, itemOf("A", paragraph("a1", "the item's text"))]]);
    const { held, store } = memoryStore(items);
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
    const items = new Map([[A, itemOf("A", paragraph("a1", "A one"))]]);
    const { store } = memoryStore(items);
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
    const items = new Map([[A, itemOf("A", paragraph("a1", "the item's text"))]]);
    const { held, store } = memoryStore(items);
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
    const { store } = memoryStore(new Map());
    render(<Host itemId={A} ports={portsOver(store)} />);
    await expect(screen.findByText(MISSING_ITEM)).resolves.toBeDefined();
    expect(editable()).toBeNull();
  });
});
