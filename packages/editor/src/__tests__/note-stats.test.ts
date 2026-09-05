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

function editorOver(value: Value) {
  return createPlateEditor({ plugins: EDITOR_KIT, value });
}

describe("the count beside the outline", () => {
  it("counts words per block, so two list items are two words apart", () => {
    const editor = editorOver([
      { type: "p", children: [{ text: "Hello  wide " }, { text: "world", bold: true }] },
      {
        type: "ul",
        children: [
          { type: "li", children: [{ type: "lic", children: [{ text: "one" }] }] },
          { type: "li", children: [{ type: "lic", children: [{ text: "two" }] }] },
        ],
      },
    ]);
    expect(collectNoteStats(editor)).toEqual({ words: 5, characters: 23 });
  });

  it("counts a frontmatter node as nothing", () => {
    const editor = editorOver([
      { type: "frontmatter", value: "title: Big\ntags: [a, b]", children: [{ text: "" }] },
      { type: "p", children: [{ text: "body" }] },
    ]);
    expect(collectNoteStats(editor)).toEqual({ words: 1, characters: 4 });
  });

  it("calls an empty note empty", () => {
    expect(collectNoteStats(editorOver([{ type: "p", children: [{ text: "" }] }]))).toEqual({
      words: 0,
      characters: 0,
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
    publishNoteStats("a.md", { words: 3, characters: 12 });
    expect(readNoteStats("a.md")).toEqual({ words: 3, characters: 12 });
    expect(readNoteStats("b.md")).toBeNull();
    clearNoteStats("a.md");
    expect(readNoteStats("a.md")).toBeNull();
  });
});
