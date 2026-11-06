// The item session over a real replica: the engine on its in-memory SQLite, reaching a fake cell
// through its own transport, with the editor's own block merge, so a pause, a write, a CONFLICT
// and a landing run as they do on a device.

import { setTimeout as delay } from "node:timers/promises";

import { createSlateEditor, ElementApi, NodeApi } from "platejs";
import type { Path, SlateEditor } from "platejs";
import { describe, expect, it, vi } from "vitest";

import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import type { FakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import type { TestDevice } from "@repo/library-replica/test-support/replica-harness";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";

import { itemView } from "@repo/editor/codec/item-view";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { blockId } from "@repo/editor/node-props";
import { replicaMerge } from "@repo/editor/stale-write";

import { readElement } from "./item-diff";
import { itemProperties } from "./item-properties";
import { createItemSession, ITEM_IDLE_MS, KEPT_CHANGING } from "./item-session";
import type { ItemSession, ItemStore, ItemStoreChange } from "./item-session";

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

const cellBlock = (cell: FakeCell, itemId: string, id: string): LibraryBlock | undefined =>
  cell.item(itemId)?.blocks.get(id)?.block;

const editorText = (editor: SlateEditor, index: number): string => {
  const node = editor.children[index];
  const read = ElementApi.isElement(node) ? readElement(node) : null;
  return read?.kind === "block" ? textOf(read.block) : "";
};

// a note made on the Mac and landed, which the phone has pulled
const landedNote = async (
  cell: FakeCell,
  mac: TestDevice,
  phone: TestDevice,
  blocks: readonly LibraryBlock[],
): Promise<string> => {
  const { id } = await mac.replica.createNote({
    blocks: blocks.map((block, index) => ({ block, ord: `a${String(index)}`, section: "note" })),
    folderId: null,
    tags: [],
    title: "Plans",
  });
  await mac.replica.sync();
  await phone.replica.sync();
  return id;
};

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

// the phone's replica as the session reaches it, each write it is handed kept by name
const recorded = (phone: TestDevice): Recorded => {
  const writes: string[] = [];
  const store: ItemStore = {
    item: phone.replica.item,
    onChange: phone.replica.onChange,
    write: async (itemId, input) => {
      writes.push(...input.ops.map(named));
      return await phone.replica.write(itemId, input);
    },
  };
  return { store, writes };
};

// the phone's editor over the item, opened and following it, with Plate's ids on as the app runs
// it: Plate turns its id plugin off under NODE_ENV=test
interface Opened {
  readonly editor: SlateEditor;
  readonly session: ItemSession;
  // the titles each merge that kept this editor's lines over another device's was said under
  readonly overlaps: readonly string[];
}

const openOn = async (
  phone: TestDevice,
  itemId: string,
  store: ItemStore = phone.replica,
): Promise<Opened> => {
  const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT });
  const overlaps: string[] = [];
  const session = createItemSession(itemId, editor, {
    after: phone.clock.after,
    notifyOverlap: (title) => {
      overlaps.push(title);
    },
    store,
  });
  await session.start();
  return { editor, overlaps, session };
};

// what a pause in typing does: the timer fires, and the write it starts is let finish
const pause = async (phone: TestDevice, session: ItemSession): Promise<void> => {
  phone.clock.advance(ITEM_IDLE_MS);
  await delay(0);
  await session.flush();
};

const devices = async () => {
  const cell = createFakeCell();
  const mac = await openDevice(cell, "mac");
  const phone = await openDevice(cell, "phone", { merge: replicaMerge });
  return { cell, mac, phone };
};

describe("an item open in the editor", () => {
  it("opens on the item's blocks, each element the block its id names", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first"), code("c1", ["one"])]);
    const { editor, session } = await openOn(phone, id);
    expect(editor.children.map((node) => node.id)).toEqual(["p1", "c1"]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans" }, kind: "open" });
  });

  it("opens an item that reaches this device after the editor asked for it", async () => {
    const { mac, phone } = await devices();
    const { id } = await mac.replica.createNote({
      blocks: [{ block: paragraph("p1", "first"), ord: "a0", section: "note" }],
      folderId: null,
      tags: [],
      title: "Plans",
    });
    await mac.replica.sync();
    const { editor, session } = await openOn(phone, id);
    expect(session.status()).toEqual({ kind: "missing" });
    await phone.replica.sync();
    await session.flush();
    expect(editor.children.map((node) => node.id)).toEqual(["p1"]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans" }, kind: "open" });
  });

  it("writes nothing until a pause, then the edit as ops in the outbox, and lands them", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first"), paragraph("p2", "x")]);
    const { editor, session } = await openOn(phone, id);
    editor.tf.insertText(" words", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    expect(phone.replica.status().unsent).toBe(0);
    expect(session.status()).toMatchObject({ unsaved: true });
    await pause(phone, session);
    expect(phone.replica.status().unsent).toBe(1);
    expect(session.status()).toMatchObject({ unsaved: false });
    expect(cell.item(id)?.blocks.get("p1")?.block).toEqual(paragraph("p1", "first"));
    await phone.replica.sync();
    expect(cellBlock(cell, id, "p1")).toEqual(paragraph("p1", "first words"));
    expect(cellBlock(cell, id, "p2")).toEqual(paragraph("p2", "x"));
  });

  it("writes only the block typed in, though Plate names every element inside the others", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [
      paragraph("p1", "first"),
      code("c1", ["one", "two"]),
      table("t1", [["a", "b"]]),
    ]);
    const { store, writes } = recorded(phone);
    const { editor, session } = await openOn(phone, id, store);
    expect(nestedIdAt(editor, [1, 0])).toBeDefined();
    expect(nestedIdAt(editor, [2, 0, 1])).toBeDefined();
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(phone, session);
    expect(writes).toEqual(["put:p1"]);
    await phone.replica.sync();
    expect(cellBlock(cell, id, "c1")).toEqual(code("c1", ["one", "two"]));
    expect(cellBlock(cell, id, "t1")).toEqual(table("t1", [["a", "b"]]));
  });

  it("writes back no block laid in from another device", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [
      paragraph("p1", "first"),
      code("c1", ["one"]),
      table("t1", [["a"]]),
    ]);
    const { store, writes } = recorded(phone);
    const { editor, session } = await openOn(phone, id, store);
    const onMac = await mac.replica.item(id);
    const hashOf = (wanted: string): string =>
      onMac?.blocks.find((held) => held.block.id === wanted)?.hash ?? "";
    await mac.replica.write(id, {
      ops: [
        { baseHash: hashOf("c1"), block: code("c1", ["one", "two, from the Mac"]), op: "put" },
        { baseHash: hashOf("t1"), block: table("t1", [["a", "b"]]), op: "put" },
      ],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    await session.flush();
    expect(editorText(editor, 1)).toBe("one\ntwo, from the Mac");
    expect(nestedIdAt(editor, [2, 0, 1])).toBeDefined();
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    await pause(phone, session);
    expect(writes).toEqual(["put:p1"]);
  });

  it("settles a CONFLICT through the merge, keeping both devices' edits to one block", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [code("c1", ["one", "two", "three"])]);
    const { editor, overlaps, session } = await openOn(phone, id);
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[0];
    const mine = await mac.replica.write(id, {
      ops: [
        {
          baseHash: held?.hash ?? "",
          block: code("c1", ["one", "two", "three, from the Mac"]),
          op: "put",
        },
      ],
    });
    expect(mine.kind).toBe("queued");
    await mac.replica.sync();
    editor.tf.insertText(", from the phone", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    await pause(phone, session);
    await phone.replica.sync();
    await session.flush();
    const merged = ["one, from the phone", "two", "three, from the Mac"];
    expect(textOf(cellBlock(cell, id, "c1") ?? paragraph("c1", ""))).toBe(merged.join("\n"));
    expect(editorText(editor, 0)).toBe(merged.join("\n"));
    expect(phone.replica.status().unsent).toBe(0);
    expect(overlaps).toEqual([]);
  });

  it("says a CONFLICT whose merge kept this device's line over the other's change to it", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [code("c1", ["one", "two"])]);
    const { editor, overlaps, session } = await openOn(phone, id);
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[0];
    await mac.replica.write(id, {
      ops: [
        { baseHash: held?.hash ?? "", block: code("c1", ["one, the Mac's", "two"]), op: "put" },
      ],
    });
    await mac.replica.sync();
    editor.tf.insertText(", the phone's", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    await pause(phone, session);
    await phone.replica.sync();
    await session.flush();
    expect(overlaps).toEqual(["Plans"]);
    expect(textOf(cellBlock(cell, id, "c1") ?? paragraph("c1", ""))).toBe("one, the phone's\ntwo");
  });

  it("says a landing whose merge kept this editor's line over the other device's", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [code("c1", ["one", "two"])]);
    const { editor, overlaps, session } = await openOn(phone, id);
    editor.tf.insertText(", the phone's", { at: { offset: 3, path: [0, 0, 0] } });
    session.edited();
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[0];
    await mac.replica.write(id, {
      ops: [
        { baseHash: held?.hash ?? "", block: code("c1", ["one, the Mac's", "two"]), op: "put" },
      ],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    await session.flush();
    expect(overlaps).toEqual(["Plans"]);
    expect(editorText(editor, 0)).toBe("one, the phone's\ntwo");
  });

  it("lays another device's edit to another block into the open editor, outside its undo", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first"), paragraph("p2", "x")]);
    const { editor, session } = await openOn(phone, id);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    const undos = editor.history.undos.length;
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[1];
    await mac.replica.write(id, {
      ops: [{ baseHash: held?.hash ?? "", block: paragraph("p2", "from the Mac"), op: "put" }],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    await session.flush();
    expect(editorText(editor, 0)).toBe("first!");
    expect(editorText(editor, 1)).toBe("from the Mac");
    expect(editor.history.undos.length).toBe(undos);
    await phone.replica.sync();
    expect(cellBlock(cell, id, "p1")).toEqual(paragraph("p1", "first!"));
    expect(cellBlock(cell, id, "p2")).toEqual(paragraph("p2", "from the Mac"));
  });

  it("keeps its blocks while a replica that started over holds the row ahead of the body", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first"), paragraph("p2", "x")]);
    // the replica as it reads just after a reset: the row pulled again, its blocks still to come
    let startedOver = false;
    const told = new Set<(change: ItemStoreChange) => void>();
    const store: ItemStore = {
      item: async (itemId) => {
        const held = await phone.replica.item(itemId);
        return held === null || !startedOver ? held : { ...held, blocks: [], bodyHeld: false };
      },
      onChange: (listener) => {
        told.add(listener);
        const stop = phone.replica.onChange(listener);
        return () => {
          told.delete(listener);
          stop();
        };
      },
      write: phone.replica.write,
    };
    const { editor, session } = await openOn(phone, id, store);
    startedOver = true;
    for (const listener of told) {
      listener({ ids: new Set(), overlapped: new Set(), reset: true });
    }
    await session.flush();
    expect(editor.children.map((node) => node.id)).toEqual(["p1", "p2"]);
    expect(session.status()).toMatchObject({ kind: "open", unsaved: false });
    // the body lands again, carrying another device's edit, and the editor follows it
    startedOver = false;
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[1];
    await mac.replica.write(id, {
      ops: [{ baseHash: held?.hash ?? "", block: paragraph("p2", "from the Mac"), op: "put" }],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    await session.flush();
    expect(editorText(editor, 0)).toBe("first");
    expect(editorText(editor, 1)).toBe("from the Mac");
  });

  it("keeps a link to an item by its id through the item's rename", async () => {
    const { cell, mac, phone } = await devices();
    const { id: target } = await mac.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Target",
    });
    const link: LibraryNode = {
      children: [{ text: "" }],
      itemId: target,
      title: "Target",
      type: "wikiLink",
    };
    const id = await landedNote(cell, mac, phone, [
      { children: [{ text: "see " }, link], id: "l1", type: "p" },
    ]);
    const { editor, session } = await openOn(phone, id);
    await mac.replica.write(target, {
      ops: [{ base: "Target", field: "title", op: "set", value: "Renamed" }],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    editor.tf.insertText("Look: ", { at: { offset: 0, path: [0, 0] } });
    session.edited();
    await pause(phone, session);
    await phone.replica.sync();
    const stored = cell.item(id)?.blocks;
    expect(cellBlock(cell, id, "l1")?.children).toContainEqual(link);
    const view = itemView(stored ?? new Map(), {
      title: (itemId) => cell.item(itemId)?.fields.title ?? null,
    });
    expect(view.markdown).toBe(`Look: see [[Renamed|${target}]]\n`);
  });

  it("patches a field at once, over the value the item holds", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first")]);
    const { session } = await openOn(phone, id);
    await session.patch([{ base: "Plans", field: "title", op: "set", value: "Plans for May" }]);
    expect(session.status()).toMatchObject({ fields: { title: "Plans for May" } });
    await phone.replica.sync();
    expect(cell.item(id)?.fields.title).toBe("Plans for May");
  });

  it("draws the item's properties as rows and writes a row's edit as its patch", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first")]);
    await mac.replica.write(id, {
      ops: [{ key: "status", op: "property", value: "draft" }],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    const { session } = await openOn(phone, id);
    await session.flush();
    const source = itemProperties(session);
    expect(source.read(source.snapshot())).toEqual({
      kind: "valid",
      properties: [{ key: "status", type: "text", value: "draft" }],
    });
    source.commit({ kind: "set", prop: { key: "status", type: "text", value: "done" } });
    source.commit({ kind: "add", prop: { key: "rating", type: "number", value: 4 } });
    await session.flush();
    await phone.replica.sync();
    expect(cell.item(id)?.fields.properties).toEqual({ rating: 4, status: "done" });
    source.commit({ key: "status", kind: "remove" });
    await session.flush();
    await phone.replica.sync();
    expect(cell.item(id)?.fields.properties).toEqual({ rating: 4 });
  });

  it("follows the item again when it starts before its close has written", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first"), paragraph("p2", "x")]);
    const { editor, session } = await openOn(phone, id);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    const closing = session.close();
    await session.start();
    await closing;
    expect(phone.replica.status().unsent).toBe(1);
    const onMac = await mac.replica.item(id);
    const held = onMac?.blocks[1];
    await mac.replica.write(id, {
      ops: [{ baseHash: held?.hash ?? "", block: paragraph("p2", "the Mac's"), op: "put" }],
    });
    await mac.replica.sync();
    await phone.replica.sync();
    await session.flush();
    expect([editorText(editor, 0), editorText(editor, 1)]).toEqual(["first!", "the Mac's"]);
  });

  it("keeps an edit unsaved and goes again after a pause when the item keeps changing", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "first")]);
    let refusals = 0;
    const churning: ItemStore = {
      item: phone.replica.item,
      onChange: phone.replica.onChange,
      write: async (itemId, input) => {
        if (refusals < 3) {
          refusals += 1;
          const item = await phone.replica.item(itemId);
          return item === null ? { kind: "missing" } : { item, kind: "changed" };
        }
        return await phone.replica.write(itemId, input);
      },
    };
    const { editor, session } = await openOn(phone, id, churning);
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    phone.clock.advance(ITEM_IDLE_MS);
    await vi.waitFor(() => {
      expect(session.status()).toMatchObject({ failure: KEPT_CHANGING, unsaved: true });
    });
    expect(refusals).toBe(3);
    expect(phone.replica.status().unsent).toBe(0);
    await pause(phone, session);
    expect(session.status()).toMatchObject({ failure: null, unsaved: false });
    await phone.replica.sync();
    expect(cellBlock(cell, id, "p1")).toEqual(paragraph("p1", "first!"));
  });

  it("opens with no undo reaching what the editor held before the item", async () => {
    const { cell, mac, phone } = await devices();
    const id = await landedNote(cell, mac, phone, [paragraph("p1", "the item's text")]);
    const editor = createSlateEditor({ nodeId: true, plugins: BASE_KIT });
    editor.tf.insertText("typed before", { at: { offset: 0, path: [0, 0] } });
    const session = createItemSession(id, editor, {
      after: phone.clock.after,
      notifyOverlap: () => {
        throw new Error("nothing overlaps here");
      },
      store: phone.replica,
    });
    await session.start();
    editor.undo();
    expect(editorText(editor, 0)).toBe("the item's text");
  });
});
