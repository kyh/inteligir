// A pill's display where its source lands: in the editor that makes the change, inside that
// change, and in every other editor of the note only where two changes met.

import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import * as Y from "yjs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import type { Pill } from "@repo/editor/formulas/displays";
import { pillNode } from "@repo/editor/formulas/formula-entry";
import { pillEntries, pillOf } from "@repo/editor/formulas/pill-nodes";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { seedDoc } from "@repo/editor/live/note-blocks";
import { undoStackSizes } from "@repo/editor/live/yjs-binding";
import { stringProp } from "@repo/editor/node-props";

import { liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";

// a paragraph holding one pill, showing `display`
const line = (id: string, pill: Pill, display: string): LibraryBlock =>
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

const shown = (editor: SlateEditor): string[] =>
  pillEntries(editor.children).map(({ node }) => stringProp(node, "display") ?? "");

// the pill a name reads, with its path
const named = (editor: SlateEditor, name: string) => {
  const entry = pillEntries(editor.children).find(({ node }) => pillOf(node).name === name);
  if (entry === undefined) {
    throw new Error(`the note holds no pill named ${name}`);
  }
  return entry;
};

const setSource = (editor: SlateEditor, name: string, source: string): void => {
  editor.tf.setNodes({ source }, { at: named(editor, name).at });
};

const editorOver = (blocks: readonly TElement[]): SlateEditor =>
  createSlateEditor({ plugins: BASE_KIT, value: [...blocks] });

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

const twoDevices = (blocks: readonly LibraryBlock[]) => {
  const note = new Y.Doc();
  seedDoc(
    note,
    blocks.map((block) => ({ block, section: "note" })),
  );
  const docA = syncedCopy(note);
  const docB = syncedCopy(note);
  const net = relay([docA, docB]);
  return { a: liveEditor(docA), b: liveEditor(docB), docA, docB, net };
};

describe("a pill's display in a note two devices hold", () => {
  it("reaches the other device with its source, which then has none to write", () => {
    const { a, b, docA, docB, net } = twoDevices(ORDER);
    setSource(a, "price", "6");
    settle(net, [a, b]);

    expect(shown(b)).toStrictEqual(["6", "3", "18"]);
    expect(net.sent(docA)).toBe(1);
    expect(net.sent(docB)).toBe(0);
  });

  it("settles on what both sources give when two people change them at once, outside either's undo", () => {
    const { a, b, net } = twoDevices(ORDER);
    setSource(a, "price", "6");
    setSource(b, "qty", "4");
    settle(net, [a, b]);

    expect(shown(a)).toStrictEqual(["6", "4", "24"]);
    expect(shown(b)).toStrictEqual(shown(a));
    expect(undoStackSizes(a)).toStrictEqual({ redos: 0, undos: 1 });

    // the other's display has replaced the one this undo would put back, so it is derived again
    a.undo();
    settle(net, [a, b]);
    expect(shown(a)).toStrictEqual(["5", "4", "20"]);
    expect(shown(b)).toStrictEqual(shown(a));
    expect(undoStackSizes(a)).toStrictEqual({ redos: 1, undos: 0 });

    a.redo();
    settle(net, [a, b]);
    expect(shown(b)).toStrictEqual(["6", "4", "24"]);
    expect(undoStackSizes(a)).toStrictEqual({ redos: 0, undos: 1 });
  });
});
