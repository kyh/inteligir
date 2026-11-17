import { describe, expect, it } from "vitest";
import { NodeApi, createSlateEditor } from "platejs";
import type { SlateEditor, TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { applyBodyChanges } from "@repo/editor/headless/body/body-change";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";

const stored = (element: TElement & { readonly id: string }): LibraryBlock =>
  storableBlockSchema.parse(element);

const p = (id: string, text: string): LibraryBlock =>
  stored({ children: [{ text }], id, type: "p" });

// an editor holding `blocks`, its ids on as the app runs them (Plate turns them off under
// NODE_ENV=test), with Plate's own undo
const opened = (blocks: readonly BodyBlock[]): SlateEditor =>
  createSlateEditor({ nodeId: true, plugins: BASE_KIT, value: editorValueOf(blocks) });

const sectionsOf = (editor: SlateEditor): [string, LibrarySection][] =>
  blocksOfValue(editor.children).map(({ block, section }) => [block.id, section]);

const linesOf = (editor: SlateEditor): [string, LibrarySection][] =>
  blocksOfValue(editor.children).map(({ block, section }) => [NodeApi.string(block), section]);

// a person's editor on a note whose page a fill read
const clipped = (): SlateEditor =>
  opened([
    { block: p("mine", "my words"), section: "note" },
    { block: p("page", "the page"), section: "article" },
  ]);

describe("a block's section as the editor makes blocks", () => {
  it("files a line split off the article as the person's", () => {
    const editor = clipped();
    editor.tf.splitNodes({ at: { offset: 3, path: [1, 0] } });
    const [, page, split] = sectionsOf(editor);
    expect(page).toStrictEqual(["page", "article"]);
    expect(split?.[1]).toBe("note");
  });

  it("keeps the article's words in the article when Enter opens a line before them", () => {
    const editor = clipped();
    editor.tf.select({ offset: 0, path: [1, 0] });
    editor.tf.insertBreak();
    editor.tf.insertText("my line", { at: { offset: 0, path: [1, 0] } });
    expect(linesOf(editor)).toStrictEqual([
      ["my words", "note"],
      ["my line", "note"],
      ["the page", "article"],
    ]);
  });

  it("files the line Enter opens inside or after an article block as the person's", () => {
    const editor = clipped();
    editor.tf.select({ offset: 8, path: [1, 0] });
    editor.tf.insertBreak();
    editor.tf.select({ offset: 3, path: [1, 0] });
    editor.tf.insertBreak();
    expect(linesOf(editor)).toStrictEqual([
      ["my words", "note"],
      ["the", "article"],
      [" page", "note"],
      ["", "note"],
    ]);
  });

  it("files what is typed after Enter on an emptied article line as the person's", () => {
    const editor = clipped();
    editor.tf.delete({
      at: { anchor: { offset: 0, path: [1, 0] }, focus: { offset: 8, path: [1, 0] } },
    });
    editor.tf.select({ offset: 0, path: [1, 0] });
    editor.tf.insertBreak();
    editor.tf.insertText("typed");
    expect(linesOf(editor)).toStrictEqual([
      ["my words", "note"],
      ["", "article"],
      ["typed", "note"],
    ]);
  });

  it("files a block inserted anywhere as the person's, one copied out of the article too", () => {
    const editor = clipped();
    const [, copied] = editor.children;
    if (copied === undefined) {
      throw new Error("the article's block");
    }
    editor.tf.insertNodes({ ...copied, id: "pasted" }, { at: [2] });
    editor.tf.insertNodes({ children: [{ text: "typed" }], id: "typed", type: "p" }, { at: [1] });
    expect(sectionsOf(editor)).toStrictEqual([
      ["mine", "note"],
      ["typed", "note"],
      ["page", "article"],
      ["pasted", "note"],
    ]);
  });

  it("puts an article's block back in the article on undo", () => {
    const editor = clipped();
    editor.tf.removeNodes({ at: [1] });
    expect(sectionsOf(editor)).toStrictEqual([["mine", "note"]]);
    editor.tf.undo();
    expect(sectionsOf(editor)).toStrictEqual([
      ["mine", "note"],
      ["page", "article"],
    ]);
  });

  it("lands a block a writer placed in the article there", () => {
    const editor = clipped();
    expect(
      applyBodyChanges(editor, [
        { afterId: "page", block: p("more", "more page"), kind: "insertAfter", section: "article" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    expect(sectionsOf(editor).at(-1)).toStrictEqual(["more", "article"]);
  });

  it("opens a block a fix makes in the section of the block it came from", () => {
    const read = blocksOfValue(
      editorValueOf([
        { block: p("mine", "my words"), section: "note" },
        {
          block: stored({
            children: [
              {
                children: [
                  { children: [{ text: "one" }], type: "p" },
                  { children: [{ text: "two" }], type: "p" },
                ],
                type: "column",
                width: "100%",
              },
            ],
            id: "lone",
            type: "column_group",
          }),
          section: "article",
        },
      ]),
    );
    expect(read.map(({ block }) => block.type)).toStrictEqual(["p", "p", "p"]);
    expect(read.map(({ section }) => section)).toStrictEqual(["note", "article", "article"]);
  });
});
