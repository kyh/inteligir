import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import { FORMULA_PILL_KEY } from "@repo/editor/dialect-node-keys";
import { FORMULA_INPUT_KEY } from "@repo/editor/formulas/formula-input-key";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "../test-support/editor-harness";

const BUDGET = { display: "5", meta: "id=abc;name=budget", source: "5" };

// the editor with `see {` typed after what `before` holds, and the picker the second `{` opened
const openPicker = (before: Value[number]["children"] = [{ text: "" }]) => {
  installFakeEditorHost();
  const value: Value = [
    {
      children: [
        ...before,
        { text: "see {" },
        { children: [{ text: "" }], type: FORMULA_INPUT_KEY },
        { text: "" },
      ],
      type: "p",
    },
  ];
  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={value} />);
  const editor = (): PlateEditor => {
    if (ref.current === null) {
      throw new Error("the editor never mounted");
    }
    return ref.current;
  };
  // the caret inside the input, where the trigger's insert leaves it
  act(() => {
    editor().tf.select({ offset: 0, path: [0, before.length + 1, 0] });
  });
  return { markdown: () => serializeNote(editor()) };
};

const typeQuery = (query: string): void => {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
};

describe("the {{ picker", () => {
  it("typing }} after a body completes it as a formula, the lead { taken", () => {
    const { markdown } = openPicker();
    typeQuery("1+1}}");
    expect(markdown()).toBe('see :formula[2]{source="1+1"}\n');
  });

  it("typing }} with no body keeps the picker open on what was typed", () => {
    const { markdown } = openPicker();
    typeQuery("}}");
    expect(screen.getByRole("combobox")).toHaveProperty("value", "}}");
    expect(markdown()).toBe("see {\n");
  });

  it("picking a named variable inserts its linked instance once", async () => {
    const { markdown } = openPicker([
      { text: "" },
      { children: [{ text: "" }], type: FORMULA_PILL_KEY, ...BUDGET },
      { text: " " },
    ]);
    fireEvent.click(await screen.findByRole("option", { name: /budget/u }));
    const pill = ':formula[5]{meta="id=abc;name=budget" source="5"}';
    expect(markdown()).toBe(`${pill} see ${pill}\n`);
  });
});
