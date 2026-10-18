// A long note's top level renders in runs of blocks, each a box that skips its layout and paint while
// off screen (EditorChunk, editor-chrome.tsx), and every block stays mounted: a run is never
// unmounted, so find, a selection and a link far down the note reach real dom.

import { act, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { EDITOR_CHUNK } from "@repo/editor/style-hooks";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const paragraphs = (count: number): string =>
  `${Array.from({ length: count }, (_, index) => `Paragraph ${String(index + 1)}.`).join("\n\n")}\n`;

const mount = async (path: string, markdown: string): Promise<HTMLElement> => {
  const store = createOpenNoteStore();
  store.publishOpenPath(path);
  const view = render(
    <OpenNoteStoreProvider store={store}>
      <MarkdownEditor path={path} value={markdown} onChange={() => {}} />
    </OpenNoteStoreProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  const editable = view.container.querySelector<HTMLElement>('[data-slate-editor="true"]');
  if (editable === null) {
    throw new Error("the note opens rich");
  }
  return editable;
};

// a run's blocks are its own children, so the box is all that stands between them and the editable
const runs = (editable: HTMLElement): HTMLElement[] =>
  [...editable.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && Object.hasOwn(child.dataset, "slateChunk"),
  );

describe("a long note's top level", () => {
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
    const editable = await mount("long.md", paragraphs(250));
    const boxes = runs(editable);
    expect(boxes.map((box) => box.children.length)).toEqual([100, 100, 50]);
    for (const box of boxes) {
      expect(box.classList.contains(EDITOR_CHUNK)).toBe(true);
    }
    expect(editable.textContent).toContain("Paragraph 250.");
  });

  it("draws a short note's blocks with no box around them", async () => {
    const editable = await mount("short.md", paragraphs(40));
    expect(runs(editable)).toEqual([]);
    expect(editable.querySelectorAll(`.${EDITOR_CHUNK}`)).toHaveLength(0);
  });
});
