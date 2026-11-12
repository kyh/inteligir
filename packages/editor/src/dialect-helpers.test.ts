import { describe, expect, it } from "vitest";
import { ElementApi } from "platejs";
import type { Descendant } from "platejs";
import { createPlateEditor } from "platejs/react";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { insertDate, insertMonthDate } from "@repo/editor/kits/date-kit";
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
