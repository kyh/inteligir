import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { applyBodyChanges } from "@repo/editor/headless/body/body-change";
import type { BodyChange } from "@repo/editor/headless/body/body-change";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";

const stored = (element: TElement & { readonly id: string }) => storableBlockSchema.parse(element);

const p = (id: string, text: string) => stored({ children: [{ text }], id, type: "p" });

const pill = (id: string, name: string, source: string, display: string) =>
  stored({
    children: [
      { text: `${name} ` },
      { children: [{ text: "" }], display, name, source, type: "formulaPill" },
    ],
    id,
    type: "p",
  });

const cell = (text: string) =>
  ({
    children: [{ children: [{ text }], type: "p" }],
    type: "td",
  }) satisfies TElement;

const table = (id: string, ...texts: readonly string[]) =>
  stored({ children: [{ children: texts.map(cell), type: "tr" }], id, type: "table" });

const editorOver = (value: TElement[]) =>
  createSlateEditor({ nodeId: true, plugins: BASE_KIT, value });

const note = (blocks: readonly LibraryBlock[]) => {
  const editor = editorOver(editorValueOf(blocks.map((block) => ({ block, section: "note" }))));
  const read = () => blocksOfValue(editor.children);

  const base = (id: string) => {
    const found = read().find(({ block }) => block.id === id);

    if (found === undefined) {
      throw new Error(`the note holds no ${id}`);
    }

    return found.block;
  };

  return { base, editor, read };
};

const ids = (blocks: readonly BodyBlock[]) => blocks.map(({ block }) => block.id);

describe("a body change applied through an editor holding the body", () => {
  it("settles what every pill shows in the write that changes one's source", () => {
    const { base, editor, read } = note([
      pill("price", "price", "5", "5"),
      pill("total", "total", "price*2", "10"),
    ]);

    applyBodyChanges(editor, [
      {
        base: base("price"),
        block: pill("price", "price", "6", "five"),
        blockId: "price",
        kind: "put",
      },
    ]);

    expect(read().map(({ block }) => block)).toStrictEqual([
      pill("price", "price", "6", "6"),
      pill("total", "total", "price*2", "12"),
    ]);
  });

  it("edits a block in place, so a point in it keeps its words", () => {
    const { base, editor } = note([p("one", "hello world")]);
    const beforeWorld = editor.api.pointRef({ offset: 6, path: [0, 0] });
    expect(
      applyBodyChanges(editor, [
        { base: base("one"), block: p("one", "hello brave world"), blockId: "one", kind: "put" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    expect(editor.api.string([0])).toBe("hello brave world");
    expect(beforeWorld.current).toStrictEqual({ offset: 12, path: [0, 0] });
  });

  it("edits a code point at a time, never half of a pair", () => {
    const { base, editor, read } = note([p("one", "a😀b")]);
    applyBodyChanges(editor, [
      { base: base("one"), block: p("one", "a😀😀b"), blockId: "one", kind: "put" },
    ]);
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "a😀😀b")]);
  });

  it("sets marks and props in place, and a cell's text by the cell", () => {
    const { base, editor, read } = note([p("one", "plain"), table("grid", "a1", "b1")]);

    const marked = stored({
      checked: true,
      children: [{ text: "pla" }, { bold: true, text: "in" }],
      id: "one",
      indent: 1,
      listStyleType: "todo",
      type: "p",
    });

    const inB1 = editor.api.pointRef({ offset: 2, path: [1, 0, 1, 0, 0] });
    applyBodyChanges(editor, [
      { base: base("one"), block: marked, blockId: "one", kind: "put" },
      { base: base("grid"), block: table("grid", "a1 edited", "b1"), blockId: "grid", kind: "put" },
    ]);
    expect(read().map(({ block }) => block)).toStrictEqual([
      marked,
      table("grid", "a1 edited", "b1"),
    ]);
    expect(inB1.current).toStrictEqual({ offset: 2, path: [1, 0, 1, 0, 0] });
  });

  it("replaces a block it reshapes, under its id and in its section", () => {
    const editor = editorOver(editorValueOf([{ block: p("one", "words"), section: "article" }]));
    const [read] = blocksOfValue(editor.children);

    if (read === undefined) {
      throw new Error("a block");
    }

    const code = stored({
      children: [{ children: [{ text: "words" }], type: "code_line" }],
      id: "one",
      type: "code_block",
    });

    applyBodyChanges(editor, [{ base: read.block, block: code, blockId: "one", kind: "put" }]);
    expect(blocksOfValue(editor.children)).toStrictEqual([{ block: code, section: "article" }]);
  });

  it("sets a text block's type in place, so a point in it keeps its words", () => {
    const { base, editor, read } = note([p("one", "a title")]);
    const end = editor.api.pointRef({ offset: 7, path: [0, 0] });
    const heading = stored({ children: [{ text: "A title" }], id: "one", type: "h2" });
    applyBodyChanges(editor, [{ base: base("one"), block: heading, blockId: "one", kind: "put" }]);
    expect(read().map(({ block }) => block)).toStrictEqual([heading]);
    expect(end.current).toStrictEqual({ offset: 7, path: [0, 0] });
  });

  it("edits a block around a picker someone has open in it, and leaves the picker open", () => {
    const { base, editor, read } = note([p("one", "before after")]);
    editor.tf.insertNodes(
      { children: [{ text: "" }], trigger: "/", type: "slash_input" },
      { at: { offset: 7, path: [0, 0] } },
    );
    editor.tf.insertText("que", { at: [0, 1, 0], voids: true });
    expect(base("one")).toStrictEqual(p("one", "before after"));
    applyBodyChanges(editor, [
      { base: base("one"), block: p("one", "so before and after"), blockId: "one", kind: "put" },
    ]);
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "so before and after")]);
    expect(editor.children[0]?.children).toMatchObject([
      { text: "so before and " },
      { children: [{ text: "que" }], type: "slash_input" },
      { text: "after" },
    ]);
  });

  it("inserts, drops and moves blocks by id, a batch naming a block it inserted", () => {
    const { base, editor, read } = note([p("one", "1"), p("two", "2"), p("three", "3")]);

    const changes: BodyChange[] = [
      { afterId: null, block: p("top", "0"), kind: "insertAfter", section: "article" },
      { afterId: "top", block: p("next", "0.5"), kind: "insertAfter", section: "note" },
      { base: base("two"), blockId: "two", kind: "drop" },
      { afterId: "three", base: base("one"), blockId: "one", kind: "move" },
    ];

    expect(applyBodyChanges(editor, changes)).toStrictEqual({ kind: "applied" });
    expect(ids(read())).toStrictEqual(["top", "next", "three", "one"]);
    expect(read()[0]?.section).toBe("article");
    expect(read()[1]?.section).toBe("note");
  });

  it("moves a block up, to the top, and after itself in place", () => {
    const { base, editor, read } = note([p("one", "1"), p("two", "2"), p("three", "3")]);
    applyBodyChanges(editor, [
      { afterId: "one", base: base("three"), blockId: "three", kind: "move" },
    ]);
    expect(ids(read())).toStrictEqual(["one", "three", "two"]);
    applyBodyChanges(editor, [{ afterId: null, base: base("two"), blockId: "two", kind: "move" }]);
    expect(ids(read())).toStrictEqual(["two", "one", "three"]);
    applyBodyChanges(editor, [{ afterId: "one", base: base("one"), blockId: "one", kind: "move" }]);
    expect(ids(read())).toStrictEqual(["two", "one", "three"]);
  });

  it("holds a base whatever ids the editor gave the elements inside the block", () => {
    const { base, editor, read } = note([table("grid", "a1", "b1")]);
    const before = base("grid");
    editor.tf.splitNodes({ at: { offset: 1, path: [0, 0, 0, 0, 0] } });
    editor.tf.mergeNodes({ at: [0, 0, 0, 1] });
    expect(base("grid")).toStrictEqual(before);
    expect(
      applyBodyChanges(editor, [
        { base: before, block: table("grid", "a1", "b2"), blockId: "grid", kind: "put" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    expect(read().map(({ block }) => block)).toStrictEqual([table("grid", "a1", "b2")]);
  });

  it("lands none of a batch when a base moved, and names each block that did", () => {
    const { base, editor, read } = note([p("one", "1"), p("two", "2")]);
    const stale = base("two");
    editor.tf.insertText("!", { at: { offset: 1, path: [1, 0] } });
    const held = editor.children;
    expect(
      applyBodyChanges(editor, [
        { base: base("one"), block: p("one", "uno"), blockId: "one", kind: "put" },
        { base: stale, blockId: "two", kind: "drop" },
        { afterId: "gone", block: p("new", "n"), kind: "insertAfter", section: "note" },
        { afterId: null, block: p("one", "again"), kind: "insertAfter", section: "note" },
      ]),
    ).toStrictEqual({ blockIds: ["two", "gone", "one"], kind: "moved" });
    expect(editor.children).toBe(held);
    expect(read().map(({ block }) => block)).toStrictEqual([p("one", "1"), p("two", "2!")]);
  });

  it("names a block the body holds twice as moved, since no one block answers its id", () => {
    const editor = editorOver([
      { ...p("one", "1"), section: "note" },
      { ...p("two", "2"), section: "note" },
      { ...p("one", "1"), section: "note" },
    ]);

    expect(ids(blocksOfValue(editor.children)).filter((id) => id === "one")).toHaveLength(2);
    expect(
      applyBodyChanges(editor, [
        { base: p("one", "1"), block: p("one", "uno"), blockId: "one", kind: "put" },
      ]),
    ).toStrictEqual({ blockIds: ["one"], kind: "moved" });
  });
});
