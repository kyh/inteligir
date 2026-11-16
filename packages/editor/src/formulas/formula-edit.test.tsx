import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PlateEditor } from "platejs/react";
import { beforeEach, describe, expect, it } from "vitest";

import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "../test-support/editor-harness";

const NOTE = [
  'price :formula[5]{name="price" source="5"}',
  "",
  'qty :formula[3]{name="qty" source="3"}',
  "",
  'total :formula[15]{name="total" source="price*qty"} and :formula[10]{source="price+price"}',
  "",
].join("\n");

// the note drawn, read back as the markdown of each of its blocks
const mounted = (): (() => string[]) => {
  const parsed = parseMarkdown(NOTE);
  if (!parsed.ok) {
    throw new Error("the note must parse");
  }
  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={parsed.value} />);
  return () => {
    if (ref.current === null) {
      throw new Error("the editor never mounted");
    }
    return serializeNote(ref.current).trimEnd().split("\n\n");
  };
};

// the editor of the pill showing `pill`, submitted with `entry` in place of what it held
const enter = (pill: string, entry: string): void => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: pill }));
  });
  const input = screen.getByRole("textbox", { name: "Edit formula" });
  if (!(input instanceof HTMLInputElement) || input.form === null) {
    throw new Error("the pill opened no editor");
  }
  const { form } = input;
  act(() => {
    fireEvent.change(input, { target: { value: entry } });
    fireEvent.submit(form);
  });
};

describe("a pill's editor", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it("opens on the pill's name and source", () => {
    mounted();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "15" }));
    });
    expect(screen.getByRole("textbox", { name: "Edit formula" })).toHaveProperty(
      "value",
      "total=price*qty",
    );
  });

  it("settles every pill that reads the one it changed", () => {
    const markdown = mounted();
    enter("5", "price=6");
    expect(markdown()).toStrictEqual([
      'price :formula[6]{name="price" source="6"}',
      'qty :formula[3]{name="qty" source="3"}',
      'total :formula[18]{name="total" source="price*qty"} and :formula[12]{source="price+price"}',
    ]);
  });

  it("spells a pill's new name into every source that read its old one", () => {
    const markdown = mounted();
    enter("5", "cost=5");
    expect(markdown()).toStrictEqual([
      'price :formula[5]{name="cost" source="5"}',
      'qty :formula[3]{name="qty" source="3"}',
      'total :formula[15]{name="total" source="cost*qty"} and :formula[10]{source="cost+cost"}',
    ]);
  });

  it("leaves the pill as it was for an entry that names a pill the note lacks", () => {
    const markdown = mounted();
    enter("10", "price+tax");
    expect(markdown().at(-1)).toContain(':formula[10]{source="price+price"}');
  });
});
