import type { Value } from "platejs";
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import {
  clearNoteStats,
  collectNoteStats,
  publishNoteStats,
  readNoteStats,
  readingMinutes,
} from "@repo/editor/note-stats";

const editorOver = (value: Value) => createPlateEditor({ plugins: EDITOR_KIT, value });

describe("the count beside the outline", () => {
  it("counts words per block, so two list items are two words apart", () => {
    const editor = editorOver([
      { children: [{ text: "Hello  wide " }, { bold: true, text: "world" }], type: "p" },
      {
        children: [
          { children: [{ children: [{ text: "one" }], type: "lic" }], type: "li" },
          { children: [{ children: [{ text: "two" }], type: "lic" }], type: "li" },
        ],
        type: "ul",
      },
    ]);
    expect(collectNoteStats(editor)).toEqual({ characters: 23, words: 5 });
  });

  it("counts a frontmatter node as nothing", () => {
    const editor = editorOver([
      { children: [{ text: "" }], type: "frontmatter", value: "title: Big\ntags: [a, b]" },
      { children: [{ text: "body" }], type: "p" },
    ]);
    expect(collectNoteStats(editor)).toEqual({ characters: 4, words: 1 });
  });

  it("calls an empty note empty", () => {
    expect(collectNoteStats(editorOver([{ children: [{ text: "" }], type: "p" }]))).toEqual({
      characters: 0,
      words: 0,
    });
  });
});

describe("reading time", () => {
  it("rounds up to a whole minute, and says nothing for nothing", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
  });
});

describe("the published numbers", () => {
  it("answer for their own path only, and go with the editor", () => {
    publishNoteStats("a.md", { characters: 12, words: 3 });
    expect(readNoteStats("a.md")).toEqual({ characters: 12, words: 3 });
    expect(readNoteStats("b.md")).toBeNull();
    clearNoteStats("a.md");
    expect(readNoteStats("a.md")).toBeNull();
  });
});
