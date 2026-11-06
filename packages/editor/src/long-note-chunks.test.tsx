// A long item's top level renders in runs of blocks, each a box that skips its layout and paint
// while off screen (EditorChunk, editor-chrome.tsx), and every block stays mounted: a run is never
// unmounted, so find, a selection and a link far down the item reach real dom.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EDITOR_CHUNK } from "@repo/editor/style-hooks";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { mountItem } from "./test-support/memory-item";

const paragraphs = (count: number): string =>
  `${Array.from({ length: count }, (_, index) => `Paragraph ${String(index + 1)}.`).join("\n\n")}\n`;

const mount = async (itemId: string, markdown: string): Promise<HTMLElement> => {
  const { editable } = await mountItem(itemId, markdown);
  return editable;
};

// a run's blocks are its own children, so the box is all that stands between them and the editable
const runs = (editable: HTMLElement): HTMLElement[] =>
  [...editable.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && Object.hasOwn(child.dataset, "slateChunk"),
  );

describe("a long item's top level", () => {
  beforeAll(() => {
    /* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
    class ResizeObserverStub {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    }
    /* oxlint-enable class-methods-use-this */
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    installFakeEditorHost();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders in runs of a hundred blocks, every block mounted", async () => {
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
