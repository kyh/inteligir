import type { PropertyOp } from "@repo/contract/library/field-ops";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Properties } from "./item-properties";
import { PropertiesPanel } from "./properties-panel";

const mount = (properties: Properties = {}) => {
  const onWrite = vi.fn<(op: PropertyOp) => void>();
  render(<PropertiesPanel properties={properties} onWrite={onWrite} />);
  return onWrite;
};

// Add property, opened on a type and a name
const openAdd = (type: string, name: string): void => {
  fireEvent.click(screen.getByRole("button", { name: "Add property" }));
  fireEvent.click(screen.getByRole("radio", { name: type }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: name } });
};

const submitAdd = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
};

describe("Info's Add property", () => {
  it.each([
    ["Text", "Meeting: Q3 review", "Meeting: Q3 review"],
    ["Text", "02139", "02139"],
    ["Number", "3.5", 3.5],
    ["Date", "2026-11-09", "2026-11-09"],
    ["List", "one, two", ["one", "two"]],
  ])("adds a %s typed as %s as that type's value", (type, typed, value) => {
    const onWrite = mount();
    openAdd(type, "status");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: typed } });
    submitAdd();

    expect(onWrite.mock.calls).toStrictEqual([[{ key: "status", op: "property", value }]]);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("adds a checkbox as it stands", () => {
    const onWrite = mount();
    openAdd("Checkbox", "done");
    fireEvent.click(screen.getByRole("checkbox", { name: "Value" }));
    submitAdd();

    expect(onWrite.mock.calls).toStrictEqual([[{ key: "done", op: "property", value: true }]]);
  });

  it("takes a name no longer than a line the item holds", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty(
      "maxLength",
      ITEM_FIELD_CAPS.line,
    );
  });

  it("stays open on a name the item already has, saying so, and on a number left empty", () => {
    const onWrite = mount({ status: "draft" });
    openAdd("Text", "status");
    submitAdd();
    expect(screen.getByRole("alert").textContent).toBe("This item already has one by that name.");

    fireEvent.click(screen.getByRole("radio", { name: "Number" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "count" } });
    expect(screen.queryByRole("alert")).toBeNull();
    submitAdd();

    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("stays open on a name no property can take, writing nothing for the library to refuse", () => {
    const onWrite = mount();
    openAdd("Text", "__proto__");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "x" } });
    submitAdd();

    expect(screen.getByRole("alert").textContent).toBe("No property can take that name.");
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe("a property's row", () => {
  it("shows the stored number again when left empty, and writes the one typed over it", () => {
    const onWrite = mount({ count: 3 });
    const field = screen.getByLabelText("count");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(field).toHaveProperty("value", "3");
    expect(onWrite).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.blur(field);
    expect(onWrite.mock.calls).toStrictEqual([
      [{ base: 3, key: "count", op: "property", value: 4 }],
    ]);
  });

  it("shows the stored words again on Escape, writing nothing", () => {
    const onWrite = mount({ status: "draft" });
    const field = screen.getByLabelText("status");
    fireEvent.change(field, { target: { value: "final" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);

    expect(field).toHaveProperty("value", "draft");
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("edits text holding line breaks as its lines, and writes them as typed", () => {
    const onWrite = mount({ note: "one\ntwo" });
    const field = screen.getByLabelText("note");
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: "one\ntwo\nthree" } });
    fireEvent.blur(field);

    expect(onWrite.mock.calls).toStrictEqual([
      [{ base: "one\ntwo", key: "note", op: "property", value: "one\ntwo\nthree" }],
    ]);
  });

  it("writes nothing from lines nobody changed, though a stored \\r\\n reads back as \\n", () => {
    const onWrite = mount({ note: "one\r\ntwo" });
    const field = screen.getByLabelText("note");
    fireEvent.focus(field);
    fireEvent.blur(field);

    expect(onWrite).not.toHaveBeenCalled();
  });
});
