import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BLOCK_MAX_BYTES, storableBlockSchema } from "@repo/contract/library/library-nodes";

import type { Pill } from "@repo/editor/headless/formulas/displays";
import { pillNode } from "@repo/editor/formulas/formula-entry";
import { pillEntries, pillOf, settledBody } from "@repo/editor/headless/formulas/pill-nodes";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { stringProp } from "@repo/editor/headless/node-props";

import { layBody } from "@repo/editor/headless/body/lay-body";
import { blocksOfValue } from "@repo/editor/headless/body/note-blocks";

const line = (id: string, pill: Pill, display: string) =>
  storableBlockSchema.parse({
    children: [{ text: `${id}: ` }, { ...pillNode(pill), display }],
    id,
    type: "p",
  });

const ORDER = [
  line("price", { name: "price", source: "5" }, "5"),
  line("qty", { name: "qty", source: "3" }, "3"),
  line("total", { name: "total", source: "price*qty" }, "15"),
];

const shown = (editor: SlateEditor) =>
  pillEntries(editor.children).map(({ node }) => stringProp(node, "display") ?? "");

const named = (editor: SlateEditor, name: string) => {
  const entry = pillEntries(editor.children).find(({ node }) => pillOf(node).name === name);

  if (entry === undefined) {
    throw new Error(`the note holds no pill named ${name}`);
  }

  return entry;
};

const setSource = (editor: SlateEditor, name: string, source: string) => {
  editor.tf.setNodes({ source }, { at: named(editor, name).at });
};

const editorOver = (blocks: readonly TElement[]) =>
  createSlateEditor({ nodeId: true, plugins: BASE_KIT, value: [...blocks] });

describe("a pill's display in the editor that changes one", () => {
  it("is settled as the pill is inserted, and leaves with it in one undo", () => {
    const editor = editorOver(ORDER);
    editor.tf.insertNodes(pillNode({ source: "total+1" }), { at: [0, 0] });

    expect(shown(editor)).toStrictEqual(["16", "5", "3", "15"]);
    expect(editor.history.undos).toHaveLength(1);
    editor.undo();
    expect(shown(editor)).toStrictEqual(["5", "3", "15"]);
  });

  it("follows a source every pill that reads it, in the edit's one undo step", () => {
    const editor = editorOver(ORDER);
    setSource(editor, "price", "6");

    expect(shown(editor)).toStrictEqual(["6", "3", "18"]);
    expect(editor.history.undos).toHaveLength(1);
    editor.undo();
    expect(shown(editor)).toStrictEqual(["5", "3", "15"]);
    expect(editor.history.undos).toHaveLength(0);
    editor.redo();
    expect(shown(editor)).toStrictEqual(["6", "3", "18"]);
  });

  it("is the reader's own source once the pill it names is gone", () => {
    const editor = editorOver(ORDER);
    editor.tf.removeNodes({ at: [0] });

    expect(shown(editor)).toStrictEqual(["3", "price*qty"]);
  });

  it("reads the first pill of a name again once a move changes which that is", () => {
    const editor = editorOver([
      line("one", { name: "x", source: "1" }, "1"),
      line("two", { name: "x", source: "2" }, "2"),
      line("ten", { source: "x*10" }, "10"),
    ]);

    editor.tf.moveNodes({ at: [1], to: [0] });

    expect(shown(editor)).toStrictEqual(["2", "1", "20"]);
  });

  it("is asked of no pill by typing, which touches none", () => {
    const editor = editorOver([line("sum", { name: "sum", source: "1+2" }, "?")]);
    editor.tf.insertText("so ", { at: { offset: 0, path: [0, 0] } });

    expect(shown(editor)).toStrictEqual(["?"]);
    setSource(editor, "sum", "1+3");
    expect(shown(editor)).toStrictEqual(["4"]);
  });
});

const stored = (editor: SlateEditor) => blocksOfValue(editor.children);

describe("a pill's display in a body laid from elsewhere", () => {
  it("lands as the body that was saved, with nothing left to settle and nothing in the undo", () => {
    const here = editorOver(ORDER);
    const elsewhere = editorOver(ORDER);
    setSource(elsewhere, "price", "6");

    expect(layBody(here, stored(elsewhere))).toBe(true);
    expect(shown(here)).toStrictEqual(["6", "3", "18"]);
    expect(here.history.undos).toHaveLength(0);
  });

  it("is derived again where a source changed elsewhere meets one changed here, outside the undo", () => {
    const here = editorOver(ORDER);
    const elsewhere = editorOver(ORDER);
    setSource(here, "qty", "4");
    setSource(elsewhere, "price", "6");
    const [price] = stored(elsewhere);
    const [, qty, total] = stored(here);

    if (price === undefined || qty === undefined || total === undefined) {
      throw new Error("three blocks");
    }

    expect(layBody(here, [price, qty, total])).toBe(true);
    expect(shown(here)).toStrictEqual(["6", "4", "24"]);
    expect(here.history.undos).toHaveLength(1);
    here.undo();
    expect(shown(here)).toStrictEqual(["6", "3", "18"]);
    here.redo();
    expect(shown(here)).toStrictEqual(["6", "4", "24"]);
  });
});

const displays = (body: readonly BodyBlock[] | null) =>
  body?.map(({ block }) =>
    pillEntries([block]).map(({ node }) => stringProp(node, "display") ?? ""),
  ) ?? null;

describe("a pill's display in a new item's blocks as a caller sent them", () => {
  it("is what its source gives among the item's pills, its note's and its page's alike", () => {
    const [price, qty, total] = ORDER;

    if (price === undefined || qty === undefined || total === undefined) {
      throw new Error("three blocks");
    }

    const wrong = line("total", { name: "total", source: "price*qty" }, "5");

    const body: BodyBlock[] = [
      { block: price, section: "note" },
      { block: qty, section: "article" },
      { block: wrong, section: "article" },
    ];

    const settled = settledBody(body);
    expect(displays(settled)).toStrictEqual([["5"], ["3"], ["15"]]);
    expect(settled?.[2]).toStrictEqual({ block: total, section: "article" });
    expect(settled?.[0]).toBe(body[0]);
    expect(settled?.[1]).toBe(body[1]);
  });

  it("leaves a body whose pills all show what their sources give as it is", () => {
    const body = ORDER.map((block) => ({ block, section: "note" }) satisfies BodyBlock);
    expect(settledBody(body)).toBe(body);
  });

  it("is refused as no body when settling grows a block past what one holds", () => {
    const source = "w".repeat(1024);
    const long = line("long", { name: "long", source }, source);

    const reader = storableBlockSchema.parse({
      children: [
        { text: "t".repeat(BLOCK_MAX_BYTES - 512) },
        { ...pillNode({ source: "long" }), display: "long" },
      ],
      id: "reader",
      type: "p",
    });

    expect(
      settledBody([
        { block: long, section: "note" },
        { block: reader, section: "note" },
      ]),
    ).toBeNull();
  });
});
