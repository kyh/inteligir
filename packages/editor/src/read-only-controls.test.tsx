// A note that takes no edit draws no control that would write: the model refuses the op either
// way, so a control left drawn is a press that does nothing.

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./test-support/editor-harness";

const NOTE = [
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "```inteligir-chart",
  '{"type":"bar","data":[{"label":"A","value":3}]}',
  "```",
  "",
  "```inteligir-canvas",
  "[inteligir:grid:v2]",
  "..##..",
  "```",
  "",
  "```inteligir-html",
  "<p>hello</p>",
  "```",
  "",
  "::::tabs",
  ":::tab[One]",
  "first",
  ":::",
  "",
  ":::tab[Two]",
  "second",
  ":::",
  "::::",
  "",
  'total :formula[42]{source="40+2"}',
  "",
].join("\n");

const noteValue = (): Value => {
  const parsed = parseMarkdown(NOTE);
  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }
  return parsed.value;
};

const WRITES = [
  "Table options",
  "Add row",
  "Add column",
  "Edit data",
  "Sketch",
  "Edit payload",
  "Edit",
  "Add tab",
  "Remove One",
];

const formulaInput = (): HTMLElement | null =>
  screen.queryByRole("textbox", { name: "Edit formula" });

const pressPill = (): void => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "42" }));
  });
};

describe("a note's editing controls", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it.each([
    ["a note that takes edits", false],
    ["a note that takes none", true],
  ] as const)("are drawn by %s: %s", (_note, readOnly) => {
    render(<EditorHarness readOnly={readOnly} value={noteValue()} />);
    for (const name of WRITES) {
      expect(screen.queryAllByRole("button", { name }).length > 0, name).toBe(!readOnly);
    }
    for (const name of ["Source", "Preview", "One", "Two"]) {
      expect(screen.getAllByRole("button", { name }).length, name).toBeGreaterThan(0);
    }
  });

  it("a formula's pill opens its editor, which saves on Enter", () => {
    const ref = createRef<PlateEditor>();
    render(<EditorHarness ref={ref} value={noteValue()} />);
    pressPill();
    const input = formulaInput();
    if (!(input instanceof HTMLInputElement) || input.form === null) {
      throw new Error("the pill opened no editor");
    }
    const { form } = input;

    act(() => {
      fireEvent.change(input, { target: { value: "2*4" } });
      fireEvent.submit(form);
    });

    expect(ref.current?.children.at(-1)).toMatchObject({
      children: [{ text: "total " }, { display: "8", source: "2*4" }, { text: "" }],
    });
    expect(formulaInput()).toBeNull();
  });

  it("a formula's editor closes as the note stops taking edits, and a press then opens none", () => {
    const value = noteValue();
    const view = render(<EditorHarness value={value} />);
    pressPill();
    expect(formulaInput()).not.toBeNull();

    view.rerender(<EditorHarness readOnly value={value} />);
    expect(formulaInput()).toBeNull();
    view.rerender(<EditorHarness value={value} />);
    expect(formulaInput()).toBeNull();

    view.rerender(<EditorHarness readOnly value={value} />);
    pressPill();
    expect(formulaInput()).toBeNull();
    view.rerender(<EditorHarness value={value} />);
    expect(formulaInput()).toBeNull();
  });
});
