// The item session over items held in memory as the cell holds them, with the editor's own block
// merge and a pause on a clock the case moves, so a pause, a write, a base that moved under it and
// a landing from elsewhere run as they do on a device.

import { setTimeout as delay } from "node:timers/promises";

import { createSlateEditor, ElementApi, NodeApi } from "platejs";
import type { Path, SlateEditor } from "platejs";
import { describe, expect, it, vi } from "vitest";

import type { LibraryOp } from "@repo/contract/library/block-ops";
import { BLOCK_MAX_BYTES } from "@repo/contract/library/library-nodes";
import type {
  LibraryBlock,
  LibraryNode,
  LibrarySection,
} from "@repo/contract/library/library-nodes";
import { itemOf, noteFields, paragraph } from "@repo/contract/test-support/library-items";

import { itemView } from "@repo/editor/codec/item-view";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { blockId } from "@repo/editor/node-props";

import { memoryItems } from "../test-support/memory-item";
import type { MemoryItems } from "../test-support/memory-item";
import { readElement } from "./item-diff";
import { itemProperties } from "./item-properties";
import {
  BLOCK_HELD_BACK,
  BODY_TO_COME,
  createItemSession,
  ITEM_IDLE_MS,
  ITEM_UNREAD,
  ITEM_UNSAVED,
  KEPT_CHANGING,
} from "./item-session";
import type { ItemSession, ItemSessionPorts, ItemStore, ItemStoreChange } from "./item-session";

const code = (id: string, lines: readonly string[]): LibraryBlock => ({
  children: lines.map((text) => ({ children: [{ text }], type: "code_line" })),
  id,
  type: "code_block",
});

const cellOf = (text: string): LibraryNode => ({
  children: [{ children: [{ text }], type: "p" }],
  type: "td",
});

const table = (id: string, rows: readonly (readonly string[])[]): LibraryBlock => ({
  children: rows.map((row) => ({ children: row.map(cellOf), type: "tr" })),
  id,
  type: "table",
});

const textOf = (node: LibraryNode): string =>
  "text" in node ? node.text : node.children.map(textOf).join("\n");

const editorText = (editor: SlateEditor, index: number): string => {
  const node = editor.children[index];
  const read = ElementApi.isElement(node) ? readElement(node) : null;
  return read?.kind === "block" ? textOf(read.block) : "";
};

// the session's pause on a clock the case moves: `advance` runs each timer that comes due, in
// the order they come due
interface HandClock {
  readonly after: ItemSessionPorts["after"];
  readonly advance: (ms: number) => void;
}

const handClock = (): HandClock => {
  let now = 0;
  const timers = new Set<{ readonly at: number; readonly run: () => void }>();
  return {
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const [next] = [...timers].toSorted((a, b) => a.at - b.at);
        if (next === undefined || next.at > until) {
          break;
        }
        timers.delete(next);
        now = next.at;
        next.run();
      }
      now = until;
    },
    after: (ms, run) => {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
  };
};

const ITEM = "0190a000-0000-7000-8000-000000000001";
const TARGET = "0190a000-0000-7000-8000-000000000002";

interface Library {
  readonly memory: MemoryItems;
  readonly clock: HandClock;
}

// the library with one item in it, its blocks in the order given
const libraryWith = (
  blocks: readonly LibraryBlock[],
  { section = "note", title = "Plans" }: { section?: LibrarySection; title?: string } = {},
): Library => ({
  clock: handClock(),
  memory: memoryItems([[ITEM, itemOf(blocks, noteFields({ title }), section)]]),
});

const blockIn = (memory: MemoryItems, id: string): LibraryBlock | undefined =>
  memory.item(ITEM)?.blocks.get(id)?.block;

const hashIn = (memory: MemoryItems, id: string): string =>
  memory.item(ITEM)?.blocks.get(id)?.hash ?? "";

// the id Plate gave the element at `path`, below the top level
const nestedIdAt = (editor: SlateEditor, path: Path): string | undefined => {
  const node = NodeApi.has(editor, path) ? NodeApi.get(editor, path) : undefined;
  return ElementApi.isElement(node) ? blockId(node) : undefined;
};

// an op as `op:the block it names`
const named = (op: LibraryOp): string => {
  if ("block" in op) {
    return `${op.op}:${op.block.id}`;
  }
  return "blockId" in op ? `${op.op}:${op.blockId}` : op.op;
};

interface Recorded {
  readonly store: ItemStore;
  // every op the session wrote, named
  readonly writes: string[];
}

// the store as the session reaches it, each write it is handed kept by name
const recorded = (memory: MemoryItems): Recorded => {
  const writes: string[] = [];
  const store: ItemStore = {
    item: memory.store.item,
    onChange: memory.store.onChange,
    write: async (itemId, input) => {
      writes.push(...input.ops.map(named));
      return await memory.store.write(itemId, input);
    },
  };
  return { store, writes };
};

// the editor over the item, opened and following it, with Plate's ids on as the app runs it:
// Plate turns its id plugin off under NODE_ENV=test
interface Opened {
  readonly editor: SlateEditor;
  readonly session: ItemSession;
  // the titles each merge that kept this editor's lines over another device's was said under
  readonly overlaps: readonly string[];
}

const openOn = async (
  { clock, memory }: Library,
  store: ItemStore = memory.store,
  itemId = ITEM,
): Promise<Opened> => {
  const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT });
  const overlaps: string[] = [];
  const session = createItemSession(itemId, editor, {
    after: clock.after,
    notifyOverlap: (title) => {
      overlaps.push(title);
    },
    store,
  });
  await session.start();
  return { editor, overlaps, session };
};

// what a pause in typing does: the timer fires, and the write it starts is let finish
const pause = async ({ clock }: Library, session: ItemSession): Promise<void> => {
  clock.advance(ITEM_IDLE_MS);
  await delay(0);
  await session.flush();
};

describe("an item open in the editor", () => {
  it("opens on the item's blocks, each element the block its id names", async () => {
    const library = libraryWith([paragraph("p1", "first"), code("c1", ["one"])]);
    const { editor, session } = await openOn(library);
    expect(editor.children.map((node) => node.id)).toStrictEqual(["p1", "c1"]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans" }, kind: "open" });
  });

  it("opens an item the store holds only after the editor asked for it", async () => {
    const library = libraryWith([]);
    const { editor, session } = await openOn(library, library.memory.store, TARGET);
    expect(session.status()).toStrictEqual({ kind: "missing" });
    library.memory.put(TARGET, itemOf([paragraph("p1", "first")], noteFields({ title: "Plans" })));
    await session.flush();
    expect(editor.children.map((node) => node.id)).toStrictEqual(["p1"]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans" }, kind: "open" });
  });

  it("writes nothing until a pause, then the edit as ops, which land", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText(" words", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    expect(session.status()).toMatchObject({ unsaved: true });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first"));
    await pause(library, session);
    expect(session.status()).toMatchObject({ unsaved: false });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first words"));
    expect(blockIn(memory, "p2")).toStrictEqual(paragraph("p2", "x"));
  });

  it("writes only the block typed in, though Plate names every element inside the others", async () => {
    const library = libraryWith([
      paragraph("p1", "first"),
      code("c1", ["one", "two"]),
      table("t1", [["a", "b"]]),
    ]);
    const { memory } = library;
    const { store, writes } = recorded(memory);
    const { editor, session } = await openOn(library, store);
    expect(nestedIdAt(editor, [1, 0])).toBeDefined();
    expect(nestedIdAt(editor, [2, 0, 1])).toBeDefined();
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    expect(writes).toStrictEqual(["put:p1"]);
    expect(blockIn(memory, "c1")).toStrictEqual(code("c1", ["one", "two"]));
    expect(blockIn(memory, "t1")).toStrictEqual(table("t1", [["a", "b"]]));
  });

  it("writes back no block laid in from another device", async () => {
    const library = libraryWith([
      paragraph("p1", "first"),
      code("c1", ["one"]),
      table("t1", [["a"]]),
    ]);
    const { memory } = library;
    const { store, writes } = recorded(memory);
    const { editor, session } = await openOn(library, store);
    memory.landElsewhere(ITEM, [
      {
        baseHash: hashIn(memory, "c1"),
        block: code("c1", ["one", "two, from the Mac"]),
        op: "put",
      },
      { baseHash: hashIn(memory, "t1"), block: table("t1", [["a", "b"]]), op: "put" },
    ]);
    await session.flush();
    expect(editorText(editor, 1)).toBe("one\ntwo, from the Mac");
    expect(nestedIdAt(editor, [2, 0, 1])).toBeDefined();
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    expect(writes).toStrictEqual(["put:p1"]);
  });

  it("settles a write whose base moved through the merge, keeping both devices' edits to one block", async () => {
    const library = libraryWith([code("c1", ["one", "two", "three"])]);
    const { memory } = library;
    const { editor, overlaps, session } = await openOn(library);
    memory.landElsewhere(
      ITEM,
      [
        {
          baseHash: hashIn(memory, "c1"),
          block: code("c1", ["one", "two", "three, from the Mac"]),
          op: "put",
        },
      ],
      { quiet: true },
    );
    editor.tf.insertText(", from the phone", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    await pause(library, session);
    const merged = ["one, from the phone", "two", "three, from the Mac"];
    expect(textOf(blockIn(memory, "c1") ?? paragraph("c1", ""))).toBe(merged.join("\n"));
    expect(editorText(editor, 0)).toBe(merged.join("\n"));
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    expect(overlaps).toStrictEqual([]);
  });

  it("says a settle whose merge kept this device's line over the other's change to it", async () => {
    const library = libraryWith([code("c1", ["one", "two"])]);
    const { memory } = library;
    const { editor, overlaps, session } = await openOn(library);
    memory.landElsewhere(
      ITEM,
      [{ baseHash: hashIn(memory, "c1"), block: code("c1", ["one, the Mac's", "two"]), op: "put" }],
      { quiet: true },
    );
    editor.tf.insertText(", the phone's", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    await pause(library, session);
    expect(overlaps).toStrictEqual(["Plans"]);
    expect(textOf(blockIn(memory, "c1") ?? paragraph("c1", ""))).toBe("one, the phone's\ntwo");
  });

  it("says a landing whose merge kept this editor's line over the other device's", async () => {
    const library = libraryWith([code("c1", ["one", "two"])]);
    const { memory } = library;
    const { editor, overlaps, session } = await openOn(library);
    editor.tf.insertText(", the phone's", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "c1"), block: code("c1", ["one, the Mac's", "two"]), op: "put" },
    ]);
    await session.flush();
    expect(overlaps).toStrictEqual(["Plans"]);
    expect(editorText(editor, 0)).toBe("one, the phone's\ntwo");
  });

  it("lays another device's edit to another block into the open editor, which no undo takes back", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "p2"), block: paragraph("p2", "from the Mac"), op: "put" },
    ]);
    await session.flush();
    expect(editorText(editor, 0)).toBe("first!");
    expect(editorText(editor, 1)).toBe("from the Mac");
    editor.undo();
    expect(editorText(editor, 1)).toBe("from the Mac");
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
    expect(blockIn(memory, "p2")).toStrictEqual(paragraph("p2", "from the Mac"));
  });

  it("starts the undo over when a block lands above the last edit, which leaves others whole", async () => {
    const library = libraryWith([
      paragraph("p1", "keep this sentence"),
      paragraph("p2", "typed here"),
    ]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("XYZ", { at: { offset: 5, path: [1, 0] } });
    session.edited();
    await pause(library, session);
    memory.landElsewhere(ITEM, [
      { block: paragraph("p0", "above"), op: "insert", ord: "Zz", section: "note" },
    ]);
    await session.flush();
    expect(editorText(editor, 0)).toBe("above");
    editor.undo();
    expect([editorText(editor, 1), editorText(editor, 2)]).toStrictEqual([
      "keep this sentence",
      "typedXYZ here",
    ]);
    session.edited();
    await pause(library, session);
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "keep this sentence"));
  });

  it("starts the undo over when a block above the last edit goes, and goes on recording", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "typed here")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("XYZ", { at: { offset: 5, path: [1, 0] } });
    session.edited();
    await pause(library, session);
    memory.landElsewhere(ITEM, [{ baseHash: hashIn(memory, "p1"), blockId: "p1", op: "drop" }]);
    await session.flush();
    expect(() => {
      editor.undo();
    }).not.toThrow();
    expect(editorText(editor, 0)).toBe("typedXYZ here");
    editor.tf.insertText("!", { at: { offset: 0, path: [0, 0] } });
    expect(editorText(editor, 0)).toBe("!typedXYZ here");
    editor.undo();
    expect(editorText(editor, 0)).toBe("typedXYZ here");
  });

  it("starts the undo over when the block under the last edit is laid in anew", async () => {
    const library = libraryWith([paragraph("p1", "a long first line")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 2, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "p1"), block: paragraph("p1", "short"), op: "put" },
    ]);
    await session.flush();
    expect(editorText(editor, 0)).toBe("short");
    expect(() => {
      editor.undo();
    }).not.toThrow();
    expect(editorText(editor, 0)).toBe("short");
  });

  it("drops what a redo would replay when a landing moves the blocks under it", async () => {
    const library = libraryWith([paragraph("p1", "typed here")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("XYZ", { at: { offset: 5, path: [0, 0] } });
    editor.undo();
    memory.landElsewhere(ITEM, [
      { block: paragraph("p0", "above"), op: "insert", ord: "Zz", section: "note" },
    ]);
    await session.flush();
    editor.redo();
    expect([editorText(editor, 0), editorText(editor, 1)]).toStrictEqual(["above", "typed here"]);
  });

  it("keeps the undo through its own write coming back", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    library.memory.tell(ITEM);
    await session.flush();
    editor.undo();
    expect(editorText(editor, 0)).toBe("first");
  });

  it("keeps its blocks while the store holds the item's row ahead of its body", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    // the store as it reads with the item's row in and its blocks still to come
    let bodyToCome = false;
    const told = new Set<(change: ItemStoreChange) => void>();
    const store: ItemStore = {
      item: async (itemId) => {
        const held = await memory.store.item(itemId);
        return held === null || !bodyToCome ? held : { ...held, blocks: [], bodyHeld: false };
      },
      onChange: (listener) => {
        told.add(listener);
        const stop = memory.store.onChange(listener);
        return () => {
          told.delete(listener);
          stop();
        };
      },
      write: memory.store.write,
    };
    const { editor, session } = await openOn(library, store);
    bodyToCome = true;
    for (const listener of told) {
      listener({ ids: new Set(), overlapped: new Set(), reset: true });
    }
    await session.flush();
    expect(editor.children.map((node) => node.id)).toStrictEqual(["p1", "p2"]);
    expect(session.status()).toMatchObject({ kind: "open", unsaved: false });
    // the body lands again, carrying another device's edit, and the editor follows it
    bodyToCome = false;
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "p2"), block: paragraph("p2", "from the Mac"), op: "put" },
    ]);
    await session.flush();
    expect(editorText(editor, 0)).toBe("first");
    expect(editorText(editor, 1)).toBe("from the Mac");
  });

  it("keeps a link to an item by its id through the item's rename", async () => {
    const link: LibraryNode = {
      children: [{ text: "" }],
      key: TARGET,
      type: "mention",
      value: "Target",
    };
    const library = libraryWith([{ children: [{ text: "see " }, link], id: "l1", type: "p" }]);
    const { memory } = library;
    memory.put(TARGET, itemOf([], noteFields({ title: "Target" })));
    const { editor, session } = await openOn(library);
    memory.landElsewhere(TARGET, [{ base: "Target", field: "title", op: "set", value: "Renamed" }]);
    editor.tf.insertText("Look: ", { at: { offset: 0, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    expect(blockIn(memory, "l1")?.children).toContainEqual(link);
    const view = itemView(memory.item(ITEM)?.blocks ?? new Map(), {
      title: (itemId) => memory.item(itemId)?.fields.title ?? null,
    });
    expect(view.markdown).toBe(`Look: see [Renamed](mention:${TARGET})\n`);
  });

  it("patches a field at once, over the value the item holds", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { session } = await openOn(library);
    await session.patch([{ base: "Plans", field: "title", op: "set", value: "Plans for May" }]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans for May" } });
    expect(library.memory.item(ITEM)?.fields.title).toBe("Plans for May");
  });

  it("draws the item's properties as rows and writes a row's edit as its patch", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    memory.landElsewhere(ITEM, [{ key: "status", op: "property", value: "draft" }]);
    const { session } = await openOn(library);
    await session.flush();
    const source = itemProperties(session);
    expect(source.read(source.snapshot())).toStrictEqual([
      { key: "status", type: "text", value: "draft" },
    ]);
    source.commit({ kind: "set", prop: { key: "status", type: "text", value: "done" } });
    source.commit({ kind: "add", prop: { key: "rating", type: "number", value: 4 } });
    await session.flush();
    expect(memory.item(ITEM)?.fields.properties).toStrictEqual({ rating: 4, status: "done" });
    source.commit({ key: "status", kind: "remove" });
    await session.flush();
    expect(memory.item(ITEM)?.fields.properties).toStrictEqual({ rating: 4 });
  });

  it("follows the item again when it starts before its close has written", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    const closing = session.close();
    await session.start();
    await closing;
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "p2"), block: paragraph("p2", "the Mac's"), op: "put" },
    ]);
    await session.flush();
    expect([editorText(editor, 0), editorText(editor, 1)]).toStrictEqual(["first!", "the Mac's"]);
  });

  it("keeps an edit unsaved and goes again after a pause when the item keeps changing", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    let refusals = 0;
    const churning: ItemStore = {
      item: memory.store.item,
      onChange: memory.store.onChange,
      write: async (itemId, input) => {
        if (refusals < 3) {
          refusals += 1;
          const item = await memory.store.item(itemId);
          return item === null ? { kind: "missing" } : { item, kind: "changed" };
        }
        return await memory.store.write(itemId, input);
      },
    };
    const { editor, session } = await openOn(library, churning);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    library.clock.advance(ITEM_IDLE_MS);
    await vi.waitFor(() => {
      expect(session.status()).toMatchObject({ failure: KEPT_CHANGING, unsaved: true });
    });
    expect(refusals).toBe(3);
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first"));
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
  });

  it("holds an edit over a body still to come, says so to a leave, and writes it once it lands", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    let toCome = true;
    const store: ItemStore = {
      item: memory.store.item,
      onChange: memory.store.onChange,
      write: async (itemId, input) =>
        toCome ? { kind: "waiting" } : await memory.store.write(itemId, input),
    };
    const { editor, session } = await openOn(library, store);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await session.flush();
    expect(session.status()).toMatchObject({ failure: BODY_TO_COME, kind: "open", unsaved: true });
    expect([editorText(editor, 0), editorText(editor, 1)]).toStrictEqual(["first!", "x"]);

    toCome = false;
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
  });

  it("files what the person types under a saved page's article in the note", async () => {
    const library = libraryWith([paragraph("a1", "the page")], {
      section: "article",
      title: "Saved",
    });
    const { editor, session } = await openOn(library);
    editor.tf.insertNodes({ children: [{ text: "mine" }], type: "p" }, { at: [1] });
    session.edited();
    await pause(library, session);
    const held = [...(library.memory.item(ITEM)?.blocks.values() ?? [])];
    expect(held.map(({ section }) => section).toSorted()).toStrictEqual(["article", "note"]);
    expect(held.find(({ section }) => section === "note")?.block.children).toStrictEqual([
      { text: "mine" },
    ]);
  });

  it("files an article block it dropped back in the article when an undo restores it", async () => {
    const library = libraryWith([paragraph("a1", "the page"), paragraph("a2", "goes on")], {
      section: "article",
      title: "Saved",
    });
    const { editor, session } = await openOn(library);
    editor.tf.removeNodes({ at: [1] });
    session.edited();
    await pause(library, session);
    editor.undo();
    session.edited();
    await pause(library, session);
    expect(library.memory.item(ITEM)?.blocks.get("a2")?.section).toBe("article");
  });

  it("files text still unwritten in the note when a page's article lands above it", async () => {
    const library = libraryWith([]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("mine", { at: { offset: 0, path: [0, 0] } });
    session.edited();
    memory.landElsewhere(ITEM, [
      { block: paragraph("a1", "the page"), op: "insert", ord: "a0", section: "article" },
    ]);
    await pause(library, session);
    const held = [...(memory.item(ITEM)?.blocks.values() ?? [])];
    expect(held.find(({ section }) => section === "note")?.block.children).toStrictEqual([
      { text: "mine" },
    ]);
    expect(blockIn(memory, "a1")).toStrictEqual(paragraph("a1", "the page"));
  });

  it("says a block no write can store and holds it unsaved, until it can be written", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { editor, session } = await openOn(library);
    editor.tf.insertText("y".repeat(BLOCK_MAX_BYTES), { at: { offset: 1, path: [1, 0] } });
    session.edited();
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: BLOCK_HELD_BACK, unsaved: true });
    await session.flush();
    expect(session.status()).toMatchObject({ failure: BLOCK_HELD_BACK, unsaved: true });
    editor.undo();
    session.edited();
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    expect(blockIn(library.memory, "p2")).toStrictEqual(paragraph("p2", "x"));
  });

  it("writes the blocks it can beside the one it holds back", async () => {
    const library = libraryWith([paragraph("p1", "first"), paragraph("p2", "x")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    editor.tf.insertText("y".repeat(BLOCK_MAX_BYTES), { at: { offset: 1, path: [1, 0] } });
    session.edited();
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: BLOCK_HELD_BACK, unsaved: true });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
    expect(blockIn(memory, "p2")).toStrictEqual(paragraph("p2", "x"));
  });

  it("keeps a block it holds back on screen when another device changes that block", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("y".repeat(BLOCK_MAX_BYTES), { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(library, session);
    memory.landElsewhere(ITEM, [
      { baseHash: hashIn(memory, "p1"), block: paragraph("p1", "the Mac's"), op: "put" },
    ]);
    await session.flush();
    expect(NodeApi.string(editor.children[0] ?? { text: "" }).startsWith("firsty")).toBe(true);
    expect(session.status()).toMatchObject({ failure: BLOCK_HELD_BACK, unsaved: true });
  });

  it("keeps an edit unsaved and goes again after a pause when the store rejects the write", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    let rejections = 1;
    const failing: ItemStore = {
      item: memory.store.item,
      onChange: memory.store.onChange,
      write: async (itemId, input) => {
        if (rejections > 0) {
          rejections -= 1;
          throw new Error("the cell gave no answer");
        }
        return await memory.store.write(itemId, input);
      },
    };
    const { editor, session } = await openOn(library, failing);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await session.flush();
    expect(session.status()).toMatchObject({ failure: ITEM_UNSAVED, unsaved: true });
    await pause(library, session);
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
  });

  it("answers a flush unsaved for as long as the store rejects the write", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    const refusing: ItemStore = {
      item: memory.store.item,
      onChange: memory.store.onChange,
      write: async () => {
        await Promise.resolve();
        throw new Error("the page gave up waiting for the phone");
      },
    };
    const { editor, session } = await openOn(library, refusing);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await session.flush();
    await session.flush();
    expect(session.status()).toMatchObject({ failure: ITEM_UNSAVED, unsaved: true });
    await session.close();
    expect(session.status()).toMatchObject({ failure: ITEM_UNSAVED, unsaved: true });
  });

  it("says a field patch the item cannot hold, and still writes the blocks beside it", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    await session.patch([{ key: "k".repeat(1001), op: "property", value: "v" }]);
    expect(session.status()).toMatchObject({
      failure: "This item can't hold these properties.",
      unsaved: false,
    });
    expect(blockIn(memory, "p1")).toStrictEqual(paragraph("p1", "first!"));
    expect(memory.item(ITEM)?.fields.properties).toStrictEqual({});
  });

  it("says a field patch the item cannot hold when nothing else is left to write", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { session } = await openOn(library);
    await session.patch([{ key: "k".repeat(1001), op: "property", value: "v" }]);
    expect(session.status()).toMatchObject({
      failure: "This item can't hold these properties.",
      unsaved: false,
    });
  });

  it("goes on writing after a surface it told throws", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { editor, session } = await openOn(library);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    const stop = session.subscribe(() => {
      throw new Error("the surface broke");
    });
    await expect(session.flush()).rejects.toThrow("the surface broke");
    stop();
    editor.tf.insertText("?", { at: { offset: 6, path: [0, 0] } });
    session.edited();
    await session.flush();
    expect(blockIn(library.memory, "p1")).toStrictEqual(paragraph("p1", "first!?"));
  });

  it("says a first read that failed, and opens the item when asked again", async () => {
    const library = libraryWith([paragraph("p1", "first")]);
    const { memory } = library;
    let rejections = 1;
    const failing: ItemStore = {
      item: async (itemId) => {
        if (rejections > 0) {
          rejections -= 1;
          throw new Error("the page gave up waiting for the phone");
        }
        return await memory.store.item(itemId);
      },
      onChange: memory.store.onChange,
      write: memory.store.write,
    };
    const { editor, session } = await openOn(library, failing);
    expect(session.status()).toStrictEqual({ failure: ITEM_UNREAD, kind: "unread" });
    await session.read();
    expect(session.status()).toMatchObject({ failure: null, kind: "open" });
    expect(editorText(editor, 0)).toBe("first");
  });

  it("opens with no undo reaching what the editor held before the item", async () => {
    const library = libraryWith([paragraph("p1", "the item's text")]);
    const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT });
    editor.tf.insertText("typed before", { at: { offset: 0, path: [0, 0] } });
    const session = createItemSession(ITEM, editor, {
      after: library.clock.after,
      notifyOverlap: () => {
        throw new Error("nothing overlaps here");
      },
      store: library.memory.store,
    });
    await session.start();
    editor.undo();
    expect(editorText(editor, 0)).toBe("the item's text");
  });
});
