// @vitest-environment jsdom

import type { PropertyOp } from "@repo/contract/library/field-ops";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Properties } from "./item-properties";
import { PropertiesPanel } from "./properties-panel";

afterEach(cleanup);

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

  it("writes nothing from a line nobody typed in", () => {
    const onWrite = mount({ note: "one\ntwo" });
    const field = screen.getByLabelText("note");
    fireEvent.focus(field);
    fireEvent.blur(field);

    expect(onWrite).not.toHaveBeenCalled();
  });
});
