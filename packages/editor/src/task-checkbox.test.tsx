// A task's checkbox carries its own name: an unnamed Base UI checkbox asks the document for the
// <label>s pointing at it on every render, a walk of the whole note per task, which made a long
// note with many tasks slow to open (block-list.tsx).

import { cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import { afterEach, describe, expect, it } from "vitest";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./test-support/editor-harness";

afterEach(cleanup);

const valueOf = (md: string): Value => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }
  return parsed.value;
};

describe("a task's checkbox", () => {
  it("is named, open or done", () => {
    const view = render(
      <EditorHarness
        value={valueOf("- [ ] buy milk\n- [x] water the plants\n")}
        store={createOpenNoteStore()}
      />,
    );
    const boxes = view.getAllByRole("checkbox", { name: "Done" });
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });
});
