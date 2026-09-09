// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { collectHeadings, goToHeading } from "@repo/editor/toc";
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

describe("going to a heading", () => {
  it("puts the caret at the heading's start", () => {
    const editor = mountValue([h("h1", "Top"), p("body"), h("h2", "Later"), p("more")]);
    const later = collectHeadings(editor).find((row) => row.title === "Later");
    if (later === undefined) {
      throw new Error("the outline lost a heading");
    }
    expect(goToHeading(editor, later)).toBe(true);
    expect(editor.selection?.anchor).toEqual({ offset: 0, path: [2, 0] });
  });

  it("answers false for a heading the document no longer holds", () => {
    const editor = mountValue([h("h1", "Top"), p("body")]);
    expect(goToHeading(editor, { depth: 1, id: "9", path: [9], title: "Gone" })).toBe(false);
  });
});
