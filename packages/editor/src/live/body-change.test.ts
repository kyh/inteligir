import { describe, expect, it } from "vitest";
import type { TElement } from "platejs";
import * as Y from "yjs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { applyBodyChanges } from "@repo/editor/live/body-change";
import type { BodyChange } from "@repo/editor/live/body-change";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import type { NoteBlock } from "@repo/editor/live/note-blocks";
import { liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";
import type { LiveEditor } from "../test-support/live-notes";

const stored = (element: TElement & { readonly id: string }): LibraryBlock =>
  storableBlockSchema.parse(element);

const p = (id: string, text: string): LibraryBlock =>
  stored({ children: [{ text }], id, type: "p" });

const cell = (text: string): TElement => ({
  children: [{ children: [{ text }], type: "p" }],
  type: "td",
});

const table = (id: string, ...texts: readonly string[]): LibraryBlock =>
  stored({ children: [{ children: texts.map(cell), type: "tr" }], id, type: "table" });

// the note's own editor, which applies a writer's changes, beside a device a person types on
const note = (blocks: readonly LibraryBlock[]) => {
  const seeded = new Y.Doc();
  seedDoc(
    seeded,
    blocks.map((block) => ({ block, section: "note" })),
  );
  const objectDoc = syncedCopy(seeded);
  const deviceDoc = syncedCopy(seeded);
  const net = relay([objectDoc, deviceDoc]);
  const object = liveEditor(objectDoc, { history: false });
  const device = liveEditor(deviceDoc);
  const read = (): NoteBlock[] => readBlocks(objectDoc);
  const base = (id: string): LibraryBlock => {
    const found = read().find(({ block }) => block.id === id);
    if (found === undefined) {
      throw new Error(`the note holds no ${id}`);
    }
    return found.block;
  };
  const settleBoth = (): void => {
    settle(net, [object, device]);
  };
  return { base, device, deviceDoc, net, object, objectDoc, read, settleBoth };
};

const texts = (editor: LiveEditor): string[] =>
  editor.children.map((node) => editor.api.string(node));

const ids = (blocks: readonly NoteBlock[]): string[] => blocks.map(({ block }) => block.id);

describe("a body change applied through the note's editor", () => {
  it("edits a block in place, so what a person typed in it meanwhile stays", () => {
    const { base, device, object, settleBoth } = note([p("one", "hello world")]);
    const read = base("one");
    device.tf.insertText("Oh, ", { at: { offset: 0, path: [0, 0] } });
    expect(
      applyBodyChanges(object, [
        { base: read, block: p("one", "hello brave world"), blockId: "one", kind: "put" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    settleBoth();
    expect(texts(device)).toStrictEqual(["Oh, hello brave world"]);
    expect(texts(object)).toStrictEqual(texts(device));
  });

  it("edits a code point at a time, never half of a pair", () => {
    const { base, object, read } = note([p("one", "a😀b")]);
    applyBodyChanges(object, [
      { base: base("one"), block: p("one", "a😀😀b"), blockId: "one", kind: "put" },
    ]);
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "a😀😀b")]);
  });

  it("sets marks and props in place, and a cell's text by the cell", () => {
    const { base, device, object, read, settleBoth } = note([
      p("one", "plain"),
      table("grid", "a1", "b1"),
    ]);
    const marked = stored({
      checked: true,
      children: [{ text: "pla" }, { bold: true, text: "in" }],
      id: "one",
      indent: 1,
      listStyleType: "todo",
      type: "p",
    });
    device.tf.insertText("!", { at: { offset: 2, path: [1, 0, 1, 0, 0] } });
    applyBodyChanges(object, [
      { base: base("one"), block: marked, blockId: "one", kind: "put" },
      { base: base("grid"), block: table("grid", "a1 edited", "b1"), blockId: "grid", kind: "put" },
    ]);
    settleBoth();
    expect(read().map(({ block }) => block)).toStrictEqual([
      marked,
      table("grid", "a1 edited", "b1!"),
    ]);
  });

  it("replaces a block it reshapes, under its id and in its section", () => {
    const seeded = new Y.Doc();
    seedDoc(seeded, [{ block: p("one", "words"), section: "article" }]);
    const object = liveEditor(seeded, { history: false });
    const [read] = readBlocks(seeded);
    if (read === undefined) {
      throw new Error("a block");
    }
    const code = stored({
      children: [{ children: [{ text: "words" }], type: "code_line" }],
      id: "one",
      type: "code_block",
    });
    applyBodyChanges(object, [{ base: read.block, block: code, blockId: "one", kind: "put" }]);
    expect(readBlocks(seeded)).toStrictEqual([{ block: code, section: "article" }]);
  });

  it("sets a text block's type in place, so what a person typed in it meanwhile stays", () => {
    const { base, device, object, read, settleBoth } = note([p("one", "a title")]);
    const was = base("one");
    device.tf.insertText("!", { at: { offset: 7, path: [0, 0] } });
    const heading = stored({ children: [{ text: "A title" }], id: "one", type: "h2" });
    applyBodyChanges(object, [{ base: was, block: heading, blockId: "one", kind: "put" }]);
    settleBoth();
    expect(read().map(({ block }) => block)).toStrictEqual([
      stored({ children: [{ text: "A title!" }], id: "one", type: "h2" }),
    ]);
  });

  it("edits a block around a picker someone has open in it, and leaves the picker open", () => {
    const { base, device, object, read, settleBoth } = note([p("one", "before after")]);
    device.tf.insertNodes(
      { children: [{ text: "" }], trigger: "/", type: "slash_input" },
      { at: { offset: 7, path: [0, 0] } },
    );
    device.tf.insertText("que", { at: [0, 1, 0], voids: true });
    settleBoth();
    expect(base("one")).toStrictEqual(p("one", "before after"));
    applyBodyChanges(object, [
      { base: base("one"), block: p("one", "so before and after"), blockId: "one", kind: "put" },
    ]);
    settleBoth();
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "so before and after")]);
    expect(device.children[0]?.children).toMatchObject([
      { text: "so before and " },
      { children: [{ text: "que" }], type: "slash_input" },
      { text: "after" },
    ]);
  });

  it("inserts, drops and moves blocks by id, a batch naming a block it inserted", () => {
    const { base, object, read } = note([p("one", "1"), p("two", "2"), p("three", "3")]);
    const changes: BodyChange[] = [
      { afterId: null, block: p("top", "0"), kind: "insertAfter", section: "article" },
      { afterId: "top", block: p("next", "0.5"), kind: "insertAfter", section: "note" },
      { base: base("two"), blockId: "two", kind: "drop" },
      { afterId: "three", base: base("one"), blockId: "one", kind: "move" },
    ];
    expect(applyBodyChanges(object, changes)).toStrictEqual({ kind: "applied" });
    expect(ids(read())).toStrictEqual(["top", "next", "three", "one"]);
    expect(read()[0]?.section).toBe("article");
    expect(read()[1]?.section).toBe("note");
  });

  it("moves a block up, to the top, and after itself in place", () => {
    const { base, object, read } = note([p("one", "1"), p("two", "2"), p("three", "3")]);
    applyBodyChanges(object, [
      { afterId: "one", base: base("three"), blockId: "three", kind: "move" },
    ]);
    expect(ids(read())).toStrictEqual(["one", "three", "two"]);
    applyBodyChanges(object, [{ afterId: null, base: base("two"), blockId: "two", kind: "move" }]);
    expect(ids(read())).toStrictEqual(["two", "one", "three"]);
    applyBodyChanges(object, [{ afterId: "one", base: base("one"), blockId: "one", kind: "move" }]);
    expect(ids(read())).toStrictEqual(["two", "one", "three"]);
  });

  it("holds a base whatever ids the editors gave the elements inside the block", () => {
    const { base, device, object, read, settleBoth } = note([table("grid", "a1", "b1")]);
    const before = base("grid");
    device.tf.splitNodes({ at: { offset: 1, path: [0, 0, 0, 0, 0] } });
    device.tf.mergeNodes({ at: [0, 0, 0, 1] });
    settleBoth();
    expect(base("grid")).toStrictEqual(before);
    expect(
      applyBodyChanges(object, [
        { base: before, block: table("grid", "a1", "b2"), blockId: "grid", kind: "put" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    expect(read().map(({ block }) => block)).toStrictEqual([table("grid", "a1", "b2")]);
  });

  it("lands none of a batch when a base moved, and names each block that did", () => {
    const { base, device, net, object, objectDoc, read, settleBoth } = note([
      p("one", "1"),
      p("two", "2"),
    ]);
    const stale = base("two");
    device.tf.insertText("!", { at: { offset: 1, path: [1, 0] } });
    settleBoth();
    const sent = net.sent(objectDoc);
    expect(
      applyBodyChanges(object, [
        { base: base("one"), block: p("one", "uno"), blockId: "one", kind: "put" },
        { base: stale, blockId: "two", kind: "drop" },
        { afterId: "gone", block: p("new", "n"), kind: "insertAfter", section: "note" },
        { afterId: null, block: p("one", "again"), kind: "insertAfter", section: "note" },
      ]),
    ).toStrictEqual({ blockIds: ["two", "gone", "one"], kind: "moved" });
    settleBoth();
    expect(net.sent(objectDoc)).toBe(sent);
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "1"), p("two", "2!")]);
  });

  // a move is a delete and an insert in the document, so two editors moving one block at once
  // each insert it
  it("names a block the note holds twice as moved, since no one block answers its id", () => {
    const { device, object, read, settleBoth } = note([
      p("one", "1"),
      p("two", "2"),
      p("three", "3"),
    ]);
    device.tf.moveNodes({ at: [0], to: [2] });
    object.tf.moveNodes({ at: [0], to: [1] });
    settleBoth();
    expect(ids(read()).filter((id) => id === "one")).toHaveLength(2);
    expect(
      applyBodyChanges(object, [
        { base: p("one", "1"), block: p("one", "uno"), blockId: "one", kind: "put" },
      ]),
    ).toStrictEqual({ blockIds: ["one"], kind: "moved" });
  });
});
