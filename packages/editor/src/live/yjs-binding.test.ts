import { describe, expect, it } from "vitest";
import { ElementApi, TrailingBlockPlugin } from "platejs";
import type { AnyPluginConfig, TElement } from "platejs";
import * as Y from "yjs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { docNodes, liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";
import type { LiveEditor } from "../test-support/live-notes";

const stored = (element: TElement & { readonly id: string }): LibraryBlock =>
  storableBlockSchema.parse(element);

const p = (id: string, text: string): LibraryBlock =>
  stored({ children: [{ text }], id, type: "p" });

const cell = (text: string): TElement => ({
  children: [{ children: [{ text }], type: "p" }],
  type: "td",
});

const TABLE = stored({
  children: [
    { children: [cell("a1"), cell("b1")], type: "tr" },
    { children: [cell("a2"), cell("b2")], type: "tr" },
  ],
  id: "table",
  type: "table",
});

const COLUMNS = stored({
  children: [
    { children: [{ children: [{ text: "left" }], type: "p" }], type: "column", width: "50%" },
    { children: [{ children: [{ text: "right" }], type: "p" }], type: "column", width: "50%" },
  ],
  id: "columns",
  type: "column_group",
});

type Kit = readonly AnyPluginConfig[];

// a note's object seeded with `blocks`, and one synced device per kit, each relaying to the others
const devices = (blocks: readonly LibraryBlock[], kits: readonly Kit[]) => {
  const note = new Y.Doc();
  seedDoc(
    note,
    blocks.map((block) => ({ block, section: "note" })),
  );
  const docs = kits.map(() => syncedCopy(note));
  const net = relay(docs);
  const editors = kits.map((kit, index) => {
    const doc = docs[index];
    if (doc === undefined) {
      throw new Error("a device without its document");
    }
    return liveEditor(doc, { kit });
  });
  return { docs, editors, net };
};

const twoDevices = (blocks: readonly LibraryBlock[], kits: { readonly b?: Kit } = {}) => {
  const {
    docs: [docA, docB],
    editors: [a, b],
    net,
  } = devices(blocks, [BASE_KIT, kits.b ?? BASE_KIT]);
  if (a === undefined || b === undefined || docA === undefined || docB === undefined) {
    throw new Error("two devices");
  }
  return { a, b, docA, docB, net };
};

const texts = (editor: LiveEditor): string[] =>
  editor.children.map((node) => editor.api.string(node));

// every element's id, by its path
const idsOf = (nodes: readonly unknown[], path: readonly number[] = []): string[] =>
  nodes.flatMap((node, index): string[] => {
    if (!ElementApi.isElement(node)) {
      return [];
    }
    const at = [...path, index].join(".");
    return [`${at}=${String(node.id)}`, ...idsOf(node.children, [...path, index])];
  });

describe("an editor bound to a note's live document", () => {
  it("meets the other device on what both typed at once", () => {
    const { a, b, docA, docB, net } = twoDevices([p("one", "hello"), p("two", "world")]);
    a.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    b.tf.insertText("¿", { at: { offset: 0, path: [0, 0] } });
    b.tf.splitNodes({ at: { offset: 2, path: [1, 0] } });
    a.tf.delete({
      at: { anchor: { offset: 0, path: [1, 0] }, focus: { offset: 1, path: [1, 0] } },
    });
    settle(net, [a, b]);
    expect(texts(a)).toStrictEqual(["¿hello!", "o", "rld"]);
    expect(b.children).toStrictEqual(a.children);
    expect(docNodes(docA)).toStrictEqual(docNodes(docB));
  });

  it("holds the document's ids at every level, its own edits and the other device's alike", () => {
    const { a, b, docA, docB, net } = twoDevices([p("one", "one"), p("two", "two"), TABLE]);
    const agree = (): void => {
      settle(net, [a, b]);
      for (const [editor, doc] of [
        [a, docA],
        [b, docB],
      ] as const) {
        const ids = idsOf(editor.children);
        expect(ids).toStrictEqual(idsOf(docNodes(doc)));
        expect(ids.filter((id) => id.endsWith("=undefined"))).toStrictEqual([]);
        expect(new Set(ids.map((id) => id.split("=")[1])).size).toBe(ids.length);
      }
    };
    a.tf.splitNodes({ at: { offset: 1, path: [0, 0] } });
    agree();
    b.tf.insertNodes(
      {
        children: [{ children: [cell("x"), cell("y")], type: "tr" }],
        type: "table",
      },
      { at: [1] },
    );
    agree();
    // a paste of a block the note already holds, under its id
    a.tf.insertNodes(p("two", "pasted"), { at: [0] });
    agree();
    // a move down lands on the other device as an insert before its delete
    a.tf.moveNodes({ at: [0], to: [3] });
    agree();
    b.tf.moveNodes({ at: [4], to: [0] });
    agree();
  });

  it("connects to a seeded note without writing to it", () => {
    const { b, docA, docB, net } = twoDevices([p("one", "one"), TABLE, COLUMNS]);
    settle(net, [b]);
    expect(net.sent(docA)).toBe(0);
    expect(net.sent(docB)).toBe(0);
  });

  it("connects two devices to an empty note's one paragraph and writes nothing", () => {
    const { a, b, docA, docB, net } = twoDevices([]);
    settle(net, [a, b]);
    expect(net.sent(docA) + net.sent(docB)).toBe(0);
    expect(readBlocks(docA)).toHaveLength(1);
    expect(a.children).toStrictEqual(b.children);
  });

  it("undoes and redoes its own changes and no other device's", () => {
    const { a, b, net } = twoDevices([p("one", "one"), p("two", "two")]);
    a.tf.insertText(" mine", { at: { offset: 3, path: [0, 0] } });
    b.tf.insertText(" theirs", { at: { offset: 3, path: [1, 0] } });
    settle(net, [a, b]);
    a.tf.undo();
    settle(net, [a, b]);
    expect(texts(b)).toStrictEqual(["one", "two theirs"]);
    a.tf.redo();
    settle(net, [a, b]);
    expect(texts(b)).toStrictEqual(["one mine", "two theirs"]);
    b.undo();
    settle(net, [a, b]);
    expect(texts(a)).toStrictEqual(["one mine", "two"]);
  });

  it("keeps a write made without saving out of the undo, and still sends it", () => {
    const { a, b, net } = twoDevices([p("one", "one"), p("two", "two")]);
    a.tf.insertText(" typed", { at: { offset: 3, path: [0, 0] } });
    a.tf.withoutSaving(() => {
      a.tf.insertText(" shown", { at: { offset: 3, path: [1, 0] } });
    });
    settle(net, [a, b]);
    expect(texts(b)).toStrictEqual(["one typed", "two shown"]);
    a.tf.undo();
    settle(net, [a, b]);
    expect(texts(b)).toStrictEqual(["one", "two shown"]);
  });

  it("goes on saving after a write without saving throws", () => {
    const { a, net } = twoDevices([p("one", "one")]);
    expect(() => {
      a.tf.withoutSaving(() => {
        throw new Error("recompute failed");
      });
    }).toThrow("recompute failed");
    a.tf.insertText("!", { at: { offset: 3, path: [0, 0] } });
    settle(net, [a]);
    a.tf.undo();
    expect(texts(a)).toStrictEqual(["one"]);
  });

  // a writer normalizes its own change before it sends it, so a reader sharing its kit finds
  // nothing to fix; one that fixed it too would add the trailing paragraph a second time
  it("leaves two devices nothing to write after a change another writer normalized", () => {
    const kit = [...BASE_KIT, TrailingBlockPlugin];
    const {
      docs: [, ...readers],
      editors: [writer, ...devicesAfter],
      net,
    } = devices([p("one", "one")], [kit, kit, kit]);
    if (writer === undefined) {
      throw new Error("a writer");
    }
    writer.tf.insertNodes(
      { children: [{ children: [cell("x")], type: "tr" }], type: "table" },
      { at: [1] },
    );
    settle(net, [writer, ...devicesAfter]);
    expect(readers.map((doc) => net.sent(doc))).toStrictEqual([0, 0]);
    for (const device of devicesAfter) {
      expect(device.children.map((node) => node.type)).toStrictEqual(["p", "table", "p"]);
    }
  });

  it("lands another device's edit inside a block the touch kit locks", () => {
    const { a, b, docB, net } = twoDevices([COLUMNS], { b: TOUCH_EDITOR_KIT });
    a.tf.insertText("most ", { at: { offset: 0, path: [0, 0, 0, 0] } });
    settle(net, [a, b]);
    expect(b.api.string([0])).toBe("most leftright");
    expect(b.children).toStrictEqual(docNodes(docB));
  });
});
