import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TagsField } from "@repo/editor/properties/property-fields";
import type { TypedProperty } from "@repo/notes/markdown/frontmatter";

const mount = (key: string, value: string[]) => {
  const onChange = vi.fn<(next: TypedProperty) => void>();
  render(<TagsField prop={{ key, type: "tags", value }} onChange={onChange} />);
  return { field: screen.getByRole("textbox", { name: `${key} tags` }), onChange };
};

const commit = (field: HTMLElement, value: string): void => {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

describe("the properties panel's tags field", () => {
  it("adds a name the inline grammar can spell, a leading # dropped", () => {
    const { field, onChange } = mount("tags", ["ok"]);
    commit(field, "#area/deep");
    expect(onChange).toHaveBeenCalledWith({
      key: "tags",
      type: "tags",
      value: ["ok", "area/deep"],
    });
  });

  it("refuses a name no inline # could address, keeping the draft and saying why", () => {
    const { field, onChange } = mount("tags", []);
    commit(field, "reading list");
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveProperty("value", "reading list");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const hint = screen.getByText(/starts with a letter/u);
    expect(field.getAttribute("aria-describedby")).toBe(hint.id);

    fireEvent.change(field, { target: { value: "reading" } });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(/starts with a letter/u)).toBeNull();
  });

  it("holds free text on any other list key", () => {
    const { field, onChange } = mount("aliases", []);
    commit(field, "Reading List 2026");
    expect(onChange).toHaveBeenCalledWith({
      key: "aliases",
      type: "tags",
      value: ["Reading List 2026"],
    });
  });
});
