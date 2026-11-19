import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "@repo/editor/headless/markdown/markdown-doc";

import { EditorHarness } from "./test-support/editor-harness.test-utils";

const valueOf = (md: string) => {
  const parsed = parseMarkdown(md);

  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }

  return parsed.value;
};

describe("a task's checkbox", () => {
  it("is named, open or done", () => {
    const view = render(
      <EditorHarness value={valueOf("- [ ] buy milk\n- [x] water the plants\n")} />,
    );

    const boxes = view.getAllByRole("checkbox", { name: "Done" });
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toStrictEqual(["false", "true"]);
  });
});
