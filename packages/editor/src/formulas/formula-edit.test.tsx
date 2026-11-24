import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PlateEditor } from "platejs/react";
import { beforeEach, describe, expect, it } from "vitest";

import { parseMarkdown, serializeNote } from "@repo/editor/headless/codec/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";

import { EditorHarness } from "../test-support/editor-harness.test-utils";

const NOTE = [
  'price :formula[5]{name="price" source="5"}',
  "",
  'qty :formula[3]{name="qty" source="3"}',
  "",
  'total :formula[15]{name="total" source="price*qty"} and :formula[10]{source="price+price"}',
  "",
].join("\n");

const mounted = (note = NOTE) => {
  const parsed = parseMarkdown(note);

  if (!parsed.ok) {
    throw new Error("the note must parse");
  }

  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={parsed.value} />);

  return (() => {
    if (ref.current === null) {
      throw new Error("the editor never mounted");
    }

    return serializeNote(ref.current).trimEnd().split("\n\n");
  }) satisfies () => string[];
};

const openEditor = (pill: string) => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: pill }));
  });
};

const enter = (pill: string, entry: string) => {
  openEditor(pill);
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

const READ_FROM_EARLIER = "A formula earlier in the note is named rate, so rate reads that one.";

const noticed = () =>
  screen.queryAllByRole("textbox", { description: READ_FROM_EARLIER, name: "Edit formula" })
    .length > 0;

describe("a name two pills hold", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  const TWICE = [
    'first :formula[2]{name="rate" source="2"}',
    "",
    'again :formula[3]{name="rate" source="3"} and :formula[4]{source="4"}',
    "",
  ].join("\n");

  it.each([
    ["the later holder's", "3", true],
    ["the first holder's", "2", false],
  ])("is told in %s editor: %s", (_holder, pill, told) => {
    mounted(TWICE);
    openEditor(pill);
    expect(noticed()).toBe(told);
  });

  it("is told as it is typed into a later pill's editor, and stays allowed", () => {
    const markdown = mounted(TWICE);
    openEditor("4");
    expect(noticed()).toBe(false);
    const input = screen.getByRole("textbox", { name: "Edit formula" });
    act(() => {
      fireEvent.change(input, { target: { value: "rate=4" } });
    });
    expect(noticed()).toBe(true);

    act(() => {
      fireEvent.submit(input);
    });
    expect(markdown().at(-1)).toBe(
      'again :formula[3]{name="rate" source="3"} and :formula[4]{name="rate" source="4"}',
    );
  });
});
