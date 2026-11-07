import { deferred } from "@repo/editor/deferred";
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { TElement, Value } from "platejs";

import { insertAnnotationMarkers } from "@repo/editor/annotations/annotation-markers";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import {
  extractBlocksToNote,
  extractionTitle,
  selectedTopLevelPaths,
} from "@repo/editor/extract-note";
import type { ItemActions } from "@repo/editor/host-io";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

type NewNote = Parameters<ItemActions["createNote"]>[0];

const h2 = (id: string, text: string): TElement => ({ children: [{ text }], id, type: "h2" });
const p = (id: string, text: string): TElement => ({ children: [{ text }], id, type: "p" });

// an item's editor, answering for the item by its id as the item editor does
const editorOver = (value: Value, itemId: string | null = "item-1") => {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  if (itemId !== null) {
    registerLiveEditor(itemId, editor);
  }
  return editor;
};

type Editor = ReturnType<typeof editorOver>;

const selectAll = (editor: Editor): void => {
  editor.tf.select([]);
};

const texts = (editor: Editor): string[] =>
  editor.children.map((block) => editor.api.string(block));

const linkAt = (editor: Editor, at: number[]) =>
  editor.api.nodes<TElement>({ at, match: { type: "wikiLink" } }).next().value?.[0];

describe("what leaves", () => {
  it("is every top-level block the selection touches", () => {
    const editor = editorOver([h2("b1", "Plan"), p("b2", "one"), p("b3", "two"), p("b4", "three")]);
    editor.tf.select({ anchor: { offset: 1, path: [1, 0] }, focus: { offset: 1, path: [2, 0] } });
    expect(selectedTopLevelPaths(editor)).toStrictEqual([[1], [2]]);
  });

  it("is titled by the first heading, else the first line, else not at all", () => {
    expect(extractionTitle([p("b1", "first line\nsecond"), h2("b2", "Plan")])).toBe("Plan");
    expect(extractionTitle([p("b1", "first line\nsecond")])).toBe("first line");
    expect(extractionTitle([p("b1", "a: b")])).toBe("a: b");
    expect(extractionTitle([p("b1", "   ")])).toBe("");
    expect(extractionTitle([p("b1", "x".repeat(100))])).toBe("x".repeat(80));
  });
});

describe("the extract", () => {
  it("makes the note of the blocks as the item stores them, and leaves a link by id in their place", async () => {
    const made: NewNote[] = [];
    installFakeEditorHost({
      createNote: async (note) => {
        made.push(note);
        return await Promise.resolve("note-1");
      },
    });
    const editor = editorOver([h2("b1", "Plan"), p("b2", "one"), p("b3", "two")]);
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

    const created = await extractBlocksToNote(editor, selectedTopLevelPaths(editor));

    expect(created).toBe("note-1");
    const [note] = made;
    expect(note).toMatchObject({
      blocks: [
        { block: { children: [{ text: "one" }], id: "b2", type: "p" } },
        { block: { children: [{ text: "two" }], id: "b3", type: "p" } },
      ],
      title: "one",
    });
    const ords = note?.blocks.map(({ ord }) => ord) ?? [];
    expect(ords).toStrictEqual(ords.toSorted());
    expect(texts(editor)).toStrictEqual(["Plan", ""]);
    expect(linkAt(editor, [1])).toMatchObject({ itemId: "note-1", title: "one", type: "wikiLink" });
  });

  it("makes a note with no title of blocks with no words, and links it by id", async () => {
    const made: NewNote[] = [];
    installFakeEditorHost({
      createNote: async (note) => {
        made.push(note);
        return await Promise.resolve("note-1");
      },
    });
    const editor = editorOver([h2("b1", "Plan"), p("b2", "   ")]);

    await extractBlocksToNote(editor, [[1]]);

    expect(made).toMatchObject([{ title: "" }]);
    expect(linkAt(editor, [1])).toMatchObject({ itemId: "note-1", title: "", type: "wikiLink" });
  });

  it("undoes the removal and the link together", async () => {
    installFakeEditorHost();
    const editor = editorOver([h2("b1", "Plan"), p("b2", "one"), p("b3", "two")]);
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 0, path: [2, 0] } });
    await extractBlocksToNote(editor, selectedTopLevelPaths(editor));
    expect(editor.children).toHaveLength(2);
    editor.undo();
    expect(texts(editor)).toStrictEqual(["Plan", "one", "two"]);
  });

  it("refuses blocks that anchor a highlight, whose entry would stay behind", async () => {
    const { calls } = installFakeEditorHost();
    const editor = editorOver([h2("b1", "Plan"), p("b2", "marked text")]);
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 6, path: [1, 0] } });
    insertAnnotationMarkers(editor, "c1");
    const before = JSON.stringify(editor.children);
    selectAll(editor);

    await expect(extractBlocksToNote(editor, selectedTopLevelPaths(editor))).resolves.toBeNull();
    expect(calls).toStrictEqual([]);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("refuses a block no item can store yet", async () => {
    const { calls } = installFakeEditorHost();
    const editor = editorOver([h2("b1", "Plan"), { children: [{ text: "no id" }], type: "p" }]);
    selectAll(editor);

    await expect(extractBlocksToNote(editor, selectedTopLevelPaths(editor))).resolves.toBeNull();
    expect(calls).toStrictEqual([]);
    expect(texts(editor)).toStrictEqual(["Plan", "no id"]);
  });

  it("follows the blocks when the item moves them while the note is made", async () => {
    const create = deferred<string>();
    installFakeEditorHost({ createNote: async () => await create.promise });
    const editor = editorOver([h2("b1", "Plan"), p("b2", "one"), p("b3", "two")]);
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

    const extracting = extractBlocksToNote(editor, selectedTopLevelPaths(editor));
    editor.tf.insertNodes(p("b0", "typed above"), { at: [0] });
    create.resolve("made");

    await expect(extracting).resolves.toBe("made");
    expect(texts(editor)).toStrictEqual(["typed above", "Plan", ""]);
    expect(linkAt(editor, [2])).toMatchObject({ itemId: "made", title: "one" });
  });

  it("keeps the note but leaves the item alone when the blocks changed meanwhile", async () => {
    const edits: ((editor: Editor) => void)[] = [
      (editor) => {
        editor.tf.insertText("!", { at: { offset: 3, path: [1, 0] } });
      },
      (editor) => {
        editor.tf.removeNodes({ at: [2] });
      },
    ];
    for (const edit of edits) {
      const create = deferred<string>();
      installFakeEditorHost({ createNote: async () => await create.promise });
      const editor = editorOver([h2("b1", "Plan"), p("b2", "one"), p("b3", "two")]);
      editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

      const extracting = extractBlocksToNote(editor, selectedTopLevelPaths(editor));
      edit(editor);
      const after = JSON.stringify(editor.children);
      create.resolve("made");

      await expect(extracting).resolves.toBeNull();
      expect(JSON.stringify(editor.children)).toBe(after);
    }
  });

  it("changes nothing when the note is not made, nothing is selected or no item is open", async () => {
    installFakeEditorHost({
      createNote: async () => await Promise.reject(new Error("the replica is closed")),
    });
    const editor = editorOver([p("b1", "only")]);
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 2, path: [0, 0] } });
    const before = JSON.stringify(editor.children);
    await expect(extractBlocksToNote(editor, selectedTopLevelPaths(editor))).resolves.toBeNull();
    await expect(extractBlocksToNote(editor, [])).resolves.toBeNull();
    expect(JSON.stringify(editor.children)).toBe(before);

    const { calls } = installFakeEditorHost();
    const unheld = editorOver([p("b1", "only")], null);
    selectAll(unheld);
    await expect(extractBlocksToNote(unheld, selectedTopLevelPaths(unheld))).resolves.toBeNull();
    expect(calls).toStrictEqual([]);
  });
});
