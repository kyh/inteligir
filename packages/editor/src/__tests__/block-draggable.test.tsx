// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";

import { act, fireEvent, render, within } from "@testing-library/react";
import { createRef } from "react";
import { NodeApi } from "platejs";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const ROW_HEIGHT = 40;
const ROW_SELECTOR = ".group\\/block";

// jsdom lays nothing out, and dnd-kit measures each sortable's box to find the one a keyboard
// step lands on: every block stands in its own row, in document order.
const rowRect = function rowRect(this: Element): DOMRect {
  const index = [...document.querySelectorAll(ROW_SELECTOR)].indexOf(this);
  return index === -1 ? new DOMRect() : new DOMRect(0, index * ROW_HEIGHT, 600, ROW_HEIGHT - 8);
};

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rowRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const p = (text: string) => ({ children: [{ text }], type: "p" });

const mountValue = (value: Value): PlateEditor => {
  const ref = createRef<PlateEditor>();
  render(<EditorHarness value={value} store={createOpenNoteStore()} ref={ref} nodeIds />);
  if (ref.current === null) {
    throw new Error("the editor did not mount");
  }
  return ref.current;
};

const rowOf = (text: string): HTMLElement => {
  const row = [...document.querySelectorAll(ROW_SELECTOR)].find(
    (node) => node.querySelector('[data-slate-node="element"]')?.textContent === text,
  );
  if (!(row instanceof HTMLElement)) {
    throw new Error(`no block row reads "${text}"`);
  }
  return row;
};

// Plate's hotkeys swallow a key pressed while focus is outside the editable, so the grip is
// focused first, as a Tab onto it would be.
const pickUp = (text: string) => {
  const grip = within(rowOf(text)).getByTitle(/^Drag to move/u);
  grip.focus();
  fireEvent.keyDown(grip, { code: "Space" });
};

// the keyboard sensor arms its key listener on a timer after the drag starts
const settle = () => act(() => delay(0));

describe("dragging a block", () => {
  it("draws the drop line on the far edge of a block edited since the note opened", async () => {
    const editor = mountValue([p("one"), p("two"), p("three")]);

    await act(async () => {
      editor.tf.insertText(" more", { at: { offset: 3, path: [1, 0] } });
    });

    pickUp("one");
    await settle();
    fireEvent.keyDown(document, { code: "ArrowDown" });
    await settle();

    const target = rowOf("two more");
    expect(target.querySelector(".-bottom-px")).not.toBeNull();
    expect(target.querySelector(".-top-px")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(document, { code: "Space" });
    });
    expect(editor.children.map((node) => NodeApi.string(node))).toEqual([
      "two more",
      "one",
      "three",
    ]);
  });

  it("draws the drop line on the near edge when a block added since the note opened moves up", async () => {
    const editor = mountValue([p("one"), p("two")]);

    await act(async () => {
      editor.tf.insertNodes(p("three"), { at: [2] });
    });

    pickUp("three");
    await settle();
    fireEvent.keyDown(document, { code: "ArrowUp" });
    await settle();

    const target = rowOf("two");
    expect(target.querySelector(".-top-px")).not.toBeNull();
    expect(target.querySelector(".-bottom-px")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(document, { code: "Space" });
    });
    expect(editor.children.map((node) => NodeApi.string(node))).toEqual(["one", "three", "two"]);
  });
});
