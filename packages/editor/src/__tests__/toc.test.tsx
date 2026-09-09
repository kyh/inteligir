// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { collectHeadings, headingElement, railWindow, TOC_RAIL_CAP } from "@repo/editor/toc";
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

  it("answers null for a path the document no longer holds", () => {
    const editor = mountValue([h("h2", "Only"), p("body")]);
    expect(headingElement(editor, { depth: 2, id: "99", path: [99], title: "gone" })).toBeNull();
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
