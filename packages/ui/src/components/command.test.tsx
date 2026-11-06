// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import type { CommandRow, CommandRowGroup } from "./command";

afterEach(cleanup);

const Palette = ({ groups }: { groups: readonly CommandRowGroup[] }) => {
  const [query, setQuery] = useState("");
  return (
    <CommandDialog
      open
      onOpenChange={vi.fn<() => void>()}
      title="Palette"
      description="Rows"
      query={query}
      onQueryChange={setQuery}
      groups={groups}
    >
      <CommandInput aria-label="Find" />
      <CommandList>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((row) => (
              <CommandItem key={row.value} row={row}>
                {row.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  );
};

const row = (label: string, action?: string) => {
  const onSelect = vi.fn<() => void>();
  return { onSelect, row: { action, label, onSelect, value: label } satisfies CommandRow };
};

const footer = (): string =>
  document.querySelector("[data-slot=command-footer]")?.textContent ?? "";

describe("the palette's parts", () => {
  it("run a picked row's verb and keep the query the person typed", () => {
    const pick = row("Weekly review", "Open");
    render(
      <Palette groups={[{ heading: "Notes", items: [row("Plans", "Open").row, pick.row] }]} />,
    );
    const field = screen.getByRole("combobox", { name: "Find" });
    fireEvent.change(field, { target: { value: "week" } });
    fireEvent.click(screen.getByRole("option", { name: "Weekly review" }));
    expect(pick.onSelect).toHaveBeenCalledOnce();
    expect(field).toHaveProperty("value", "week");
  });

  it("name in the footer what Enter does to the lit row, and nothing for a row that says nothing", () => {
    render(
      <Palette
        groups={[{ heading: "Rows", items: [row("Plans", "Open").row, row("Quiet").row] }]}
      />,
    );
    const field = screen.getByRole("combobox", { name: "Find" });
    expect(footer()).toContain("Open");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(footer()).not.toContain("Open");
  });
});
