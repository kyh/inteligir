// Pure halves of the Inteligir dialect: the /month chip's first-day ISO and the
// hover preview's plain lines.

import { describe, expect, it } from "vitest";
import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";
import { createPlateEditor } from "platejs/react";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { insertDate, insertMonthDate } from "@repo/editor/kits/date-kit";
import { setLibraryTitles } from "@repo/editor/host-io";
import { notePreviewHead } from "@repo/editor/note-preview";
import { stringProp } from "@repo/editor/node-props";

const chipDates = (nodes: Descendant[]): string[] => {
  const out: string[] = [];
  for (const node of nodes) {
    if (!ElementApi.isElement(node)) {
      continue;
    }
    const date = node.type === "date" ? stringProp(node, "date") : undefined;
    if (date !== undefined) {
      out.push(date);
    }
    out.push(...chipDates(node.children));
  }
  return out;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

describe("date chip inserts", () => {
  it("/date inserts today's ISO date", () => {
    const editor = createPlateEditor({ plugins: EDITOR_KIT });
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
    insertDate(editor);
    const now = new Date();
    const iso = `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    expect(chipDates(editor.children)).toStrictEqual([iso]);
  });

  it("/month inserts the month's first day through the same node", () => {
    const editor = createPlateEditor({ plugins: EDITOR_KIT });
    editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
    insertMonthDate(editor);
    const now = new Date();
    const iso = `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-01`;
    expect(chipDates(editor.children)).toStrictEqual([iso]);
  });
});

const VOID = [{ text: "" }];
const paragraph = (children: Descendant[]): TElement => ({ children, type: "p" });

describe(notePreviewHead, () => {
  it("reads each block as a line, a link as its chip, and drops pictures and rich blocks", () => {
    const blocks: TElement[] = [
      { children: [{ text: "Title" }], type: "h1" },
      paragraph([
        { text: "Some " },
        { bold: true, text: "bold" },
        { text: " and a " },
        {
          children: VOID,
          key: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
          type: "mention",
          value: "target",
        },
        { text: " plus noted text." },
      ]),
      { children: VOID, sha: "a".repeat(64), type: "img" },
      { children: [paragraph([{ text: "quoted code" }])], type: "blockquote" },
      { children: VOID, type: "chart_block", value: "{}" },
    ];
    expect(notePreviewHead(blocks)).toBe(
      ["Title", "Some bold and a target plus noted text.", "", "quoted code"].join("\n"),
    );
  });

  it("labels a link to an item by the name it goes by now, else the title it was written with", () => {
    setLibraryTitles([{ id: "9e64c3df-c1e2-4a4d-8c07-91528f422413", title: "Plan, renamed" }]);
    const blocks = [
      paragraph([
        { text: "See " },
        {
          children: VOID,
          key: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
          type: "mention",
          value: "Plan",
        },
        { text: " and " },
        {
          children: VOID,
          key: "9e64c3df-c1e2-4a4d-8c07-91528f422415",
          type: "mention",
          value: "Gone",
        },
      ]),
    ];
    expect(notePreviewHead(blocks)).toBe("See Plan, renamed and Gone");
    setLibraryTitles([]);
  });

  it("labels a link to an item by the title it was written with, never its id", () => {
    const blocks = [
      paragraph([
        { text: "See " },
        {
          children: VOID,
          key: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
          type: "mention",
          value: "Plan",
        },
        { text: ", " },
        { children: VOID, key: "9e64c3df-c1e2-4a4d-8c07-91528f422414", type: "mention", value: "" },
        { text: " on " },
        { children: VOID, date: "2026-08-22", type: "date" },
        { text: " for " },
        { children: VOID, display: "4", source: "2+2", type: "formulaPill" },
        { text: "." },
      ]),
    ];
    expect(notePreviewHead(blocks)).toBe("See Plan, Untitled on 2026-08-22 for 4.");
  });

  it("caps at twenty lines, a soft break among them", () => {
    const blocks = Array.from({ length: 40 }, (_, i) =>
      paragraph([{ text: i === 0 ? "line 0\nline 0b" : `line ${String(i)}` }]),
    );
    const lines = notePreviewHead(blocks).split("\n");
    expect(lines).toHaveLength(20);
    expect(lines.slice(0, 3)).toStrictEqual(["line 0", "line 0b", "line 1"]);
  });
});
