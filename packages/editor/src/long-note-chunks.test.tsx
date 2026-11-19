import { beforeAll, describe, expect, it } from "vitest";

import { EDITOR_CHUNK } from "@repo/editor/style-hooks";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";
import { mountNote } from "./test-support/memory-note.test-utils";
import { memoryNotes } from "./test-support/memory-notes.test-utils";

const paragraphs = (count: number) =>
  `${Array.from({ length: count }, (_, index) => `Paragraph ${String(index + 1)}.`).join("\n\n")}\n`;

const host = { notes: memoryNotes() };

const mount = async (itemId: string, markdown: string) => {
  const { editable } = await mountNote(host.notes, itemId, markdown);

  return editable;
};

const runs = (editable: HTMLElement) =>
  [...editable.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && Object.hasOwn(child.dataset, "slateChunk"),
  );

describe("a long item's top level", () => {
  beforeAll(() => {
    installFakeEditorHost({ notes: host.notes });
  });

  it("renders in runs of a hundred blocks, every block mounted", { timeout: 30_000 }, async () => {
    const editable = await mount("long", paragraphs(250));
    const boxes = runs(editable);
    expect(boxes.map((box) => box.children.length)).toStrictEqual([100, 100, 50]);

    for (const box of boxes) {
      expect(box.classList.contains(EDITOR_CHUNK)).toBe(true);
    }

    expect(editable.textContent).toContain("Paragraph 250.");
  });

  it("draws a short item's blocks with no box around them", async () => {
    const editable = await mount("short", paragraphs(40));
    expect(runs(editable)).toStrictEqual([]);
    expect(editable.querySelectorAll(`.${EDITOR_CHUNK}`)).toHaveLength(0);
  });
});
