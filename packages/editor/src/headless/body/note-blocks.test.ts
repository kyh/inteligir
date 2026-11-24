import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";

import { blockOfElement } from "@repo/editor/headless/body/element-block";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { sectioned } from "@repo/editor/headless/kits/note-section";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { schemaPairs, usedPairs } from "../../test-support/library-node-pairs.test-utils";
import { CORPUS, LISTED, SECTIONED } from "../../test-support/stored-corpus.test-utils";

const HELD = blocksOfValue(editorValueOf(SECTIONED));

const opened = (value: readonly TElement[]) =>
  createSlateEditor({ nodeId: true, plugins: BASE_KIT, value: [...value] });

const columns = (...widths: readonly string[]) => {
  const block = blockOfElement({
    children: widths.map((width) => ({
      children: [{ children: [{ text: width }], type: "p" }],
      type: "column",
      width,
    })),
    id: "columns",
    type: "column_group",
  });

  if (block === null) {
    throw new Error("a column group the store takes");
  }

  return block;
};

describe("a note's body as an editor holds it", () => {
  it("reads every node, mark and prop the library persists, in order and section", () => {
    const used = new Set<string>();
    usedPairs(CORPUS, used);
    expect(schemaPairs().filter((pair) => !used.has(pair))).toStrictEqual([]);
    expect(
      blocksOfValue(SECTIONED.map(({ block, section }) => sectioned(block, section))),
    ).toStrictEqual(SECTIONED);
  });

  it("reads back every block an editor holds as it was opened, in order and section", () => {
    expect(HELD.length).toBeGreaterThan(CORPUS.length / 2);
    expect(blocksOfValue(editorValueOf(HELD))).toStrictEqual(HELD);
  });

  it("opens a block of every type with all the model lets it carry, and reads it back unchanged", () => {
    const listed = LISTED.map((block) => ({ block, section: "note" }) satisfies BodyBlock);
    expect(new Set(listed.map(({ block }) => block.type)).size).toBe(listed.length);
    expect(blocksOfValue(editorValueOf(listed))).toStrictEqual(listed);
  });

  it("opens a block an editor would rewrite as the editor holds it", () => {
    const held = blocksOfValue(
      editorValueOf([
        { block: columns("40%", "60%"), section: "note" },
        { block: columns("100%"), section: "note" },
      ]),
    );

    expect(held.map(({ block }) => block.type)).toStrictEqual(["column_group", "p"]);
    expect(held[0]?.block).toStrictEqual(columns("40%", "60%"));
  });

  it("opens in an editor that reads every block as it was opened and finds nothing to fix", () => {
    const value = editorValueOf(SECTIONED);
    const editor = opened(value);
    editor.tf.normalize({ force: true });
    expect(editor.operations).toStrictEqual([]);
    expect(blocksOfValue(editor.children)).toStrictEqual(blocksOfValue(value));
    const raw = opened([sectioned(columns("100%"), "note")]);
    raw.tf.normalize({ force: true });
    expect(raw.operations).not.toStrictEqual([]);
  });

  it("opens a note with no blocks as one empty paragraph of the person's", () => {
    const [only, ...rest] = blocksOfValue(editorValueOf([]));
    expect(rest).toStrictEqual([]);
    expect(only?.section).toBe("note");
    expect(only?.block).toMatchObject({ children: [{ text: "" }], type: "p" });
  });

  it("reads a block around a picker open in it, and leaves out what no store takes", () => {
    const editor = opened(
      editorValueOf([
        {
          block: { children: [{ text: "before after" }], id: "typed", type: "p" },
          section: "note",
        },
      ]),
    );

    editor.tf.insertNodes(
      { children: [{ text: "" }], trigger: "/", type: "slash_input" },
      { at: { offset: 7, path: [0, 0] } },
    );
    editor.tf.insertText("que", { at: [0, 1, 0], voids: true });
    editor.tf.insertNodes({ children: [{ text: "x" }], type: "not_a_block" }, { at: [1] });
    expect(editor.children[0]?.children).toHaveLength(3);
    expect(blocksOfValue(editor.children)).toStrictEqual([
      {
        block: { children: [{ text: "before after" }], id: "typed", type: "p" },
        section: "note",
      },
    ]);
  });
});
