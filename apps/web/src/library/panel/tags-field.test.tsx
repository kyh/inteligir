import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TagsField } from "./property-fields";

const mount = (value: string[]) => {
  const onCommit = vi.fn<(next: string[]) => void>();
  render(<TagsField label="reading" value={value} onCommit={onCommit} />);

  return { field: screen.getByRole("textbox", { name: "reading" }), onCommit };
};

const commit = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

describe("the properties panel's list field", () => {
  it("adds what was typed as it was typed, under any name", () => {
    const { field, onCommit } = mount(["ok"]);
    commit(field, "#Reading List 2026");
    expect(onCommit).toHaveBeenCalledWith(["ok", "#Reading List 2026"]);
  });

  it("adds no entry the list already holds", () => {
    const { field, onCommit } = mount(["ok"]);
    commit(field, " ok ");
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveProperty("value", "");
  });
});
