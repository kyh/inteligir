import { freeDocPath } from "@repo/notes/knowledge/doc-file";
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { TElement, Value } from "platejs";

import { insertCommentMarkers } from "@repo/editor/comments/comment-markers";
import type { CreateNewFileResult } from "@repo/editor/host-io";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import {
  extractBlocksMarkdown,
  extractBlocksToNote,
  extractionStem,
  selectedTopLevelPaths,
} from "@repo/editor/extract-note";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { installFakeEditorHost } from "./fake-editor-host";

const h2 = (text: string): TElement => ({ children: [{ text }], type: "h2" });
const p = (text: string): TElement => ({ children: [{ text }], type: "p" });

const parsed = (markdown: string): Value => {
  const result = parseMarkdown(markdown);
  if (!result.ok) {
    throw new Error(`fixture does not parse: ${result.reason}`);
  }
  return result.value;
};

const selectAll = (editor: ReturnType<typeof editorOver>): void => {
  editor.tf.select([]);
};

const linkBodyAt = (editor: ReturnType<typeof editorOver>, at: number[]) =>
  editor.api.nodes({ at, match: { type: "wikiLink" } }).next().value?.[0].body;

const editorOver = (value: Value, livePath?: string) => {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  if (livePath !== undefined) {
    registerLiveEditor(livePath, editor);
  }
  return editor;
};

describe("what leaves", () => {
  it("is the editor's own serialization of the top-level blocks the selection touches", () => {
    const editor = editorOver([h2("Plan"), p("one"), p("two"), p("three")]);
    editor.tf.select({ anchor: { offset: 1, path: [1, 0] }, focus: { offset: 1, path: [2, 0] } });
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
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

    const created = await extractBlocksToNote(editor, selectedTopLevelPaths(editor));

    expect(created).toBe("notes/one 2.md");
    expect(calls).toEqual([
      { action: "createNewFileAt", args: ["notes/one 2.md", "one\n\ntwo\n"] },
    ]);
    expect(editor.children).toHaveLength(2);
    const [, link] = editor.children;
    expect(link?.type).toBe("p");
    expect(
      editor.api.nodes({ at: [1], match: { type: "wikiLink" } }).next().value?.[0],
    ).toMatchObject({
      body: "one 2",
    });
  });

  it("links by path when the new note's name is already another note's", async () => {
    installFakeEditorHost({
      wikiTargets: [{ path: "Plan.md", title: "Plan", type: "doc" }],
    });
    const editor = editorOver([h2("Plan"), p("one")], "notes/Source.md");
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 3, path: [1, 0] } });

    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBe("notes/Plan.md");
    expect(
      editor.api.nodes({ at: [0], match: { type: "wikiLink" } }).next().value?.[0],
    ).toMatchObject({ body: "notes/Plan" });
  });

  it("undoes the removal and the link together", async () => {
    installFakeEditorHost();
    const editor = editorOver([h2("Plan"), p("one"), p("two")], "Source.md");
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 0, path: [2, 0] } });
    await extractBlocksToNote(editor, selectedTopLevelPaths(editor));
    expect(editor.children).toHaveLength(2);
    editor.undo();
    expect(editor.children.map((block) => editor.api.string(block))).toEqual([
      "Plan",
      "one",
      "two",
    ]);
  });

  it("steps past a name the create finds taken although the listing lacks it", async () => {
    const { calls } = installFakeEditorHost({
      createNewFileAt: async (path) =>
        await Promise.resolve<CreateNewFileResult>(
          path === "notes/Plan.md" ? { kind: "exists", path } : { kind: "created", path },
        ),
    });
    const editor = editorOver([h2("Plan"), p("one")], "notes/Source.md");
    selectAll(editor);

    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBe(
      "notes/Plan 2.md",
    );
    expect(calls.map(({ args }) => args[0])).toEqual(["notes/Plan.md", "notes/Plan 2.md"]);
    expect(linkBodyAt(editor, [0])).toBe("Plan 2");
  });

  it("leaves the note's frontmatter where it is, out of the extract", async () => {
    const { calls } = installFakeEditorHost();
    const editor = editorOver(
      parsed("---\nid: abc\npinned: true\n---\n\n## Plan\n\none\n"),
      "notes/Source.md",
    );
    selectAll(editor);
    expect(selectedTopLevelPaths(editor)).toEqual([[0], [1], [2]]);

    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBe("notes/Plan.md");
    expect(calls).toEqual([
      { action: "createNewFileAt", args: ["notes/Plan.md", "## Plan\n\none\n"] },
    ]);
    expect(editor.children.map((block) => block.type)).toEqual(["frontmatter", "p"]);
    expect(editor.children[0]).toMatchObject({ value: "id: abc\npinned: true" });
    expect(linkBodyAt(editor, [1])).toBe("Plan");
  });

  it("extracts nothing when the frontmatter is all that was chosen", async () => {
    const { calls } = installFakeEditorHost();
    const editor = editorOver(parsed("---\nid: abc\n---\n\none\n"), "Source.md");
    expect(await extractBlocksToNote(editor, [[0]])).toBeNull();
    expect(calls).toEqual([]);
  });

  it("refuses blocks that anchor a comment, whose thread would stay behind", async () => {
    const { calls } = installFakeEditorHost();
    const editor = editorOver([h2("Plan"), p("marked text")], "Source.md");
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 6, path: [1, 0] } });
    insertCommentMarkers(editor, "c1");
    const before = JSON.stringify(editor.children);
    selectAll(editor);

    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBeNull();
    expect(calls).toEqual([]);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("follows the blocks when the note moves them while the create is in flight", async () => {
    const create = Promise.withResolvers<CreateNewFileResult>();
    installFakeEditorHost({ createNewFileAt: async () => await create.promise });
    const editor = editorOver([h2("Plan"), p("one"), p("two")], "Source.md");
    editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

    const extracting = extractBlocksToNote(editor, selectedTopLevelPaths(editor));
    editor.tf.insertNodes(p("typed above"), { at: [0] });
    create.resolve({ kind: "created", path: "one.md" });

    expect(await extracting).toBe("one.md");
    expect(editor.children.map((block) => editor.api.string(block))).toEqual([
      "typed above",
      "Plan",
      "",
    ]);
    expect(linkBodyAt(editor, [2])).toBe("one");
  });

  it("keeps the file but leaves the buffer alone when the blocks changed meanwhile", async () => {
    const edits: ((editor: ReturnType<typeof editorOver>) => void)[] = [
      (editor) => {
        editor.tf.insertText("!", { at: { offset: 3, path: [1, 0] } });
      },
      (editor) => {
        editor.tf.removeNodes({ at: [2] });
      },
    ];
    for (const edit of edits) {
      const create = Promise.withResolvers<CreateNewFileResult>();
      installFakeEditorHost({ createNewFileAt: async () => await create.promise });
      const editor = editorOver([h2("Plan"), p("one"), p("two")], "Source.md");
      editor.tf.select({ anchor: { offset: 0, path: [1, 0] }, focus: { offset: 3, path: [2, 0] } });

      const extracting = extractBlocksToNote(editor, selectedTopLevelPaths(editor));
      edit(editor);
      const after = JSON.stringify(editor.children);
      create.resolve({ kind: "created", path: "one.md" });

      expect(await extracting).toBeNull();
      expect(JSON.stringify(editor.children)).toBe(after);
    }
  });

  it("changes nothing when the host refuses the create, or when nothing is selected", async () => {
    installFakeEditorHost({ refuseCreates: true });
    const editor = editorOver([p("only")], "Source.md");
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 2, path: [0, 0] } });
    const before = JSON.stringify(editor.children);
    expect(await extractBlocksToNote(editor, selectedTopLevelPaths(editor))).toBeNull();
    expect(await extractBlocksToNote(editor, [])).toBeNull();
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
