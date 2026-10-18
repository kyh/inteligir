// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import {
  activeHeadingAt,
  collectHeadings,
  headingElement,
  railWindow,
  TOC_RAIL_CAP,
} from "@repo/editor/toc";
import { EditorHarness } from "./editor-harness";

afterEach(cleanup);

const h = (type: "h1" | "h2" | "h3", text: string) => ({ children: [{ text }], type });
const p = (text: string) => ({ children: [{ text }], type: "p" });

const mountValue = (value: Value): PlateEditor => {
  const ref = createRef<PlateEditor>();
  render(<EditorHarness value={value} store={createOpenNoteStore()} ref={ref} />);
  if (ref.current === null) {
    throw new Error("the editor did not mount");
  }
  return ref.current;
};

describe("outline targets", () => {
  it("skips an empty heading in the outline but not in the resolution", () => {
    const editor = mountValue([h("h1", ""), h("h2", "Real"), p("body")]);

    const headings = collectHeadings(editor);
    expect(headings.map((row) => row.title)).toEqual(["Real"]);

    const [first] = headings;
    if (first === undefined) {
      throw new Error("the outline lost its only row");
    }
    expect(document.querySelectorAll("h1, h2, h3")[0]?.textContent).not.toBe("Real");
    expect(headingElement(editor, first)?.textContent).toBe("Real");
  });

  it("ignores heading elements the editor does not own", () => {
    const editor = mountValue([h("h2", "Mine"), p("body")]);
    // models a transclusion's static render: a heading in the editable that is no node of the document.
    const editable = document.querySelector('[data-slate-editor="true"]');
    if (editable === null) {
      throw new Error("no editable mounted");
    }
    editable.insertAdjacentHTML("afterbegin", "<h2>Embedded</h2>");

    const headings = collectHeadings(editor);
    const [first] = headings;
    if (first === undefined) {
      throw new Error("the outline lost its only row");
    }
    expect(first.title).toBe("Mine");
    expect(document.querySelectorAll("h2")[0]?.textContent).toBe("Embedded");
    expect(headingElement(editor, first)?.textContent).toBe("Mine");
  });

  it("follows an edit, a heading inside a block, and a block added above", () => {
    const editor = mountValue([
      h("h1", "Top"),
      { children: [h("h2", "Quoted")], type: "blockquote" },
      h("h2", "Tail"),
    ]);
    const rows = () => collectHeadings(editor).map(({ id, title }) => `${id} ${title}`);
    expect(rows()).toEqual(["0 Top", "1.0 Quoted", "2 Tail"]);

    editor.tf.insertText("s", { at: { offset: 4, path: [2, 0] } });
    expect(rows()).toEqual(["0 Top", "1.0 Quoted", "2 Tails"]);

    editor.tf.insertNodes(p("lead"), { at: [0] });
    expect(rows()).toEqual(["1 Top", "2.0 Quoted", "3 Tails"]);
  });

  it("answers null for a path the document no longer holds", () => {
    const editor = mountValue([h("h2", "Only"), p("body")]);
    expect(headingElement(editor, { depth: 2, id: "99", path: [99], title: "gone" })).toBeNull();
  });
});

// the scroller's own top at 0, so the scanner line sits at 72px
const spyScroller = (): Element => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => DOMRect.fromRect({ height: 800, width: 800, x: 0, y: 0 });
  return el;
};

// each heading's top 100px below the last, the note scrolled by `scrolledBy`; counts the measures
const placeHeadings = (editor: PlateEditor, scrolledBy: number) => {
  const reads = { count: 0 };
  for (const [index, heading] of collectHeadings(editor).entries()) {
    const el = headingElement(editor, heading);
    if (el === null) {
      throw new Error("every heading draws");
    }
    const rect = DOMRect.fromRect({ height: 20, width: 100, x: 0, y: index * 100 - scrolledBy });
    el.getBoundingClientRect = () => {
      reads.count += 1;
      return rect;
    };
  }
  return reads;
};

describe("the scroll spy", () => {
  it("lights the last heading at or above the scanner line, measuring a handful of them", () => {
    const value: Value = Array.from({ length: 64 }, (_, index) =>
      h("h2", `Section ${String(index)}`),
    );
    const editor = mountValue(value);
    const headings = collectHeadings(editor);

    const reads = placeHeadings(editor, 0);
    expect(activeHeadingAt(editor, headings, spyScroller())).toBe(0);
    // bisection over 64 headings asks about seven of them, never all
    expect(reads.count).toBeLessThanOrEqual(7);

    placeHeadings(editor, 2000);
    expect(activeHeadingAt(editor, headings, spyScroller())).toBe(20);

    placeHeadings(editor, 100_000);
    expect(activeHeadingAt(editor, headings, spyScroller())).toBe(63);
  });
});

describe("the rail window", () => {
  it("keeps the active row inside the capped rail", () => {
    expect(railWindow(25, 0)).toEqual({ end: TOC_RAIL_CAP, start: 0 });
    expect(railWindow(25, TOC_RAIL_CAP - 1)).toEqual({ end: TOC_RAIL_CAP, start: 0 });
    expect(railWindow(25, TOC_RAIL_CAP)).toEqual({ end: TOC_RAIL_CAP + 1, start: 1 });
    expect(railWindow(25, 24)).toEqual({ end: 25, start: 5 });
  });

  it("is inert for a short outline and clamps a stale index", () => {
    expect(railWindow(5, 3)).toEqual({ end: TOC_RAIL_CAP, start: 0 });
    expect(railWindow(5, 99)).toEqual({ end: TOC_RAIL_CAP, start: 0 });
  });
});
