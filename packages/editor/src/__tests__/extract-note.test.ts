import { freeDocPath } from "@repo/notes/knowledge/doc-file";
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { TElement, Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import {
  extractBlocksMarkdown,
  extractBlocksToNote,
  extractionStem,
  selectedTopLevelPaths,
} from "@repo/editor/extract-note";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { installFakeEditorHost } from "./fake-editor-host";

const h2 = (text: string): TElement => ({ type: "h2", children: [{ text }] });
const p = (text: string): TElement => ({ type: "p", children: [{ text }] });

function editorOver(value: Value, livePath?: string) {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  if (livePath !== undefined) registerLiveEditor(livePath, editor);
  return editor;
}

describe("what leaves", () => {
  it("is the editor's own serialization of the top-level blocks the selection touches", () => {
    const editor = editorOver([h2("Plan"), p("one"), p("two"), p("three")]);
    editor.tf.select({ anchor: { path: [1, 0], offset: 1 }, focus: { path: [2, 0], offset: 1 } });
    const paths = selectedTopLevelPaths(editor);
    expect(paths).toEqual([[1], [2]]);
    expect(extractBlocksMarkdown(editor, paths)).toBe("one\n\ntwo\n");
  });

  it("names the note after the first heading, else the first line, else Untitled", () => {
    expect(extractionStem([p("first line\nsecond"), h2("Plan")])).toBe("Plan");
    expect(extractionStem([p("first line\nsecond")])).toBe("first line");
    expect(extractionStem([p("a: b")])).toBe("Untitled");
    expect(extractionStem([p("Trailing dots...")])).toBe("Trailing dots");
  });

  it("lands beside the note and steps past a name the vault holds, whatever its case", () => {
    expect(freeDocPath("notes", "Plan", ["notes/plan.md", "Plan.md"])).toBe("notes/Plan 2.md");
    expect(freeDocPath("", "Plan", ["notes/Plan.md"])).toBe("Plan.md");
  });
});

describe("the extract", () => {
  it("creates the note from the selected bytes and leaves one link where they were", async () => {
    const { calls } = installFakeEditorHost({
      wikiTargets: [{ path: "notes/one.md", title: "one", type: "doc" }],
    });
    const editor = editorOver([h2("Plan"), p("one"), p("two")], "notes/Source.md");
    editor.tf.select({ anchor: { path: [1, 0], offset: 0 }, focus: { path: [2, 0], offset: 3 } });

    const created = await extractBlocksToNote(editor, selectedTopLevelPaths(editor));

    expect(created).toBe("notes/one 2.md");
    expect(calls).toEqual([{ action: "createFileAt", args: ["notes/one 2.md", "one\n\ntwo\n"] }]);
    expect(editor.children).toHaveLength(2);
    const link = editor.children[1];
    expect(link?.type).toBe("p");
    expect(
      editor.api.nodes({ at: [1], match: { type: "wikiLink" } }).next().value?.[0],
    ).toMatchObject({
      body: "one 2",
    });
  });

  it("undoes the removal and the link together", async () => {
    installFakeEditorHost();
    const editor = editorOver([h2("Plan"), p("one"), p("two")], "Source.md");
    editor.tf.select({ anchor: { path: [1, 0], offset: 0 }, focus: { path: [2, 0], offset: 0 } });
    await extractBlocksToNote(editor, selectedTopLevelPaths(editor));
    expect(editor.children).toHaveLength(2);
    editor.undo();
    expect(editor.children.map((block) => editor.api.string(block))).toEqual([
      "Plan",
      "one",
      "two",
    ]);
  });

  it("changes nothing when the host refuses the create, or when nothing is selected", async () => {
    installFakeEditorHost({ refuseCreates: true });
    const editor = editorOver([p("only")], "Source.md");
    editor.tf.select({ anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 2 } });
    const before = JSON.stringify(editor.children);
    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBeNull();
    expect(await extractBlocksToNote(editor, [])).toBeNull();
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
