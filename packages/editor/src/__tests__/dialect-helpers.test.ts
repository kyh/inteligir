// Pure halves of the Inteligir dialect: the /month chip's first-day ISO, the
// hover preview's markdown strip, and the swatch picker's lossless respell.

import { describe, expect, it } from "vitest";
import { ElementApi, type Descendant } from "platejs";
import { createPlateEditor } from "platejs/react";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { insertDate, insertMonthDate } from "@repo/editor/kits/date-kit";
import { notePreviewHead } from "@repo/editor/note-preview";
import { pickerHexFor, repaintLiteral } from "@repo/editor/kits/color-pill-kit";

function chipDates(nodes: Descendant[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (!ElementApi.isElement(node)) continue;
    if (node.type === "date" && typeof node.date === "string") out.push(node.date);
    out.push(...chipDates(node.children));
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

describe("date chip inserts", () => {
  it("/day inserts today's ISO date", () => {
    const editor = createPlateEditor({ plugins: EDITOR_KIT });
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
    insertDate(editor);
    const now = new Date();
    const iso = `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    expect(chipDates(editor.children)).toEqual([iso]);
  });

  it("/month inserts the month's first day through the same node", () => {
    const editor = createPlateEditor({ plugins: EDITOR_KIT });
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
    insertMonthDate(editor);
    const now = new Date();
    const iso = `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-01`;
    expect(chipDates(editor.children)).toEqual([iso]);
  });
});

describe("notePreviewHead", () => {
  it("drops frontmatter and dialect plumbing, strips formatting", () => {
    const md = [
      "---",
      "id: abc",
      "---",
      "# Title",
      "",
      "Some **bold** and a [[target|alias]] plus %%i:x:start%%noted%%i:x:end%% text.",
      "",
      "> quoted code",
    ].join("\n");
    expect(notePreviewHead(md)).toBe(
      ["Title", "", "Some bold and a alias plus noted text.", "", "quoted code"].join("\n"),
    );
  });

  it("caps at twenty lines", () => {
    const md = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join("\n");
    const lines = notePreviewHead(md).split("\n");
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe("line 0");
  });
});

describe("color pill picker mapping", () => {
  it("reads every matched form as #rrggbb", () => {
    expect(pickerHexFor("#abc")).toBe("#aabbcc");
    expect(pickerHexFor("#A1B2C3")).toBe("#a1b2c3");
    expect(pickerHexFor("#a1b2c3d4")).toBe("#a1b2c3");
    expect(pickerHexFor("rgb(10, 11, 12)")).toBe("#0a0b0c");
    expect(pickerHexFor("rgba(10,11,12,0.5)")).toBe("#0a0b0c");
  });

  it("respells in the literal's own form, alpha preserved", () => {
    expect(repaintLiteral("#abc", "#112233")).toBe("#112233");
    expect(repaintLiteral("#aabbcc", "#112233")).toBe("#112233");
    expect(repaintLiteral("#aabbccdd", "#112233")).toBe("#112233dd");
    expect(repaintLiteral("rgb(1,2,3)", "#0a0b0c")).toBe("rgb(10, 11, 12)");
    expect(repaintLiteral("rgba(1, 2, 3, .5)", "#0a0b0c")).toBe("rgba(10, 11, 12, .5)");
  });
});
