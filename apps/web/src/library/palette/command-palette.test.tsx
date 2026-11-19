import { createORPCErrorFromJson } from "@orpc/client";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  fakePageLibrary,
  renderOnLibrary,
  spyCommands,
} from "../test-support/fake-page-library.test-utils";
import type { CellCall } from "../test-support/fake-page-library.test-utils";
import { CommandPalette } from "./command-palette";

afterEach(() => {
  onlineManager.setOnline(true);
});

const WORDS = z.object({ words: z.string() });

const drawPalette = () => {
  const cell = createFakeCell();
  const plans = cell.seed.item({ title: "Plans" });

  const hits = new Map([
    ["#todo", [cell.listed(cell.seed.item())]],
    ["spring", [{ ...cell.listed(plans), snippet: "a trip in spring" }]],
    ["https://example.com/spring", [{ ...cell.listed(plans), snippet: "example.com/spring" }]],
  ]);

  const { calls, library } = fakePageLibrary({
    answer: (call) => {
      if (call.path !== "library.listing.page") {
        return;
      }

      const { words } = WORDS.parse(call.input);

      if (words === "broken") {
        throw createORPCErrorFromJson({
          code: "BAD_REQUEST",
          data: undefined,
          defined: false,
          message: "",
        });
      }

      return { items: hits.get(words) ?? [], cursor: null, kindCounts: {}, total: 0 };
    },
    cell,
  });

  const commands = spyCommands();
  library.workspace.setPaletteOpen(true);
  renderOnLibrary(<CommandPalette />, library, commands);

  return {
    commands,
    calls,
    isOpen: () => library.workspace.store.getState().paletteOpen,
    plans,
  };
};

const searches = (calls: readonly CellCall[]) =>
  calls.flatMap((call) => (call.path === "library.listing.page" ? [call.input] : []));

const field = () => screen.getByRole("combobox", { name: "Search the library" });

const lit = () => {
  const id = field().getAttribute("aria-activedescendant");
  const option = id === null ? null : document.querySelector(`#${id}`);

  return option?.textContent ?? "";
};

const said = async (words: string, line: string) => {
  fireEvent.change(field(), { target: { value: words } });
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe(line);
  });
};

describe("the palette", () => {
  it("opens on its field, with the first command lit and named in the footer, asking the cell nothing", async () => {
    const { calls } = drawPalette();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    const list = screen.getByRole("listbox");
    expect(field().getAttribute("aria-controls")).toBe(list.id);
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toStrictEqual([
      "New note",
      "Save a link…",
      expect.stringContaining("Ask the agent"),
      "Tidy my library",
      expect.stringContaining("Settings"),
    ]);
    expect(lit()).toBe("New note");
    expect(screen.getByRole("group", { name: "Commands" })).toBeDefined();
    expect(searches(calls)).toStrictEqual([]);
  });

  it("moves the light with the arrows while the field keeps focus, and runs the lit row on Enter", async () => {
    const { commands, isOpen } = drawPalette();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(lit()).toContain("Settings");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(lit()).toBe("New note");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(lit()).toBe("Save a link…");
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(commands.askSaveLink).toHaveBeenCalledOnce();
    expect(commands.newNote).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it("searches the cell as the field changes, and opens a hit on the words it was found by", async () => {
    const { calls, commands, plans } = drawPalette();
    fireEvent.change(field(), { target: { value: "spring" } });
    const hit = await screen.findByRole("option", { name: /Plans/u });
    expect(searches(calls)).toStrictEqual([{ limit: 20, scope: { kind: "all" }, words: "spring" }]);
    expect(hit.dataset.searchHit).toBe(plans);
    expect(within(hit).getByText("a trip in spring")).toBeDefined();
    await waitFor(() => {
      expect(lit()).toContain("Plans");
    });
    expect(screen.getByText("Open")).toBeDefined();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(commands.openItem).toHaveBeenCalledWith(plans, "spring");
  });

  it("calls a hit with no title Untitled", async () => {
    drawPalette();
    fireEvent.change(field(), { target: { value: "#todo" } });
    await expect(screen.findByRole("option", { name: /Untitled/u })).resolves.toBeDefined();
  });

  it("offers to save a typed web address", async () => {
    const { commands } = drawPalette();
    fireEvent.change(field(), { target: { value: "https://example.com/a" } });
    fireEvent.click(await screen.findByRole("option", { name: "Save this link" }));
    expect(commands.saveLink).toHaveBeenCalledWith("https://example.com/a");
  });

  it("lights Save over the hits for a pasted web address, so Enter saves it", async () => {
    const { commands } = drawPalette();
    fireEvent.change(field(), { target: { value: "https://example.com/spring" } });
    await screen.findByRole("option", { name: /Plans/u });
    await waitFor(() => {
      expect(lit()).toBe("Save this link");
    });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(commands.saveLink).toHaveBeenCalledWith("https://example.com/spring");
    expect(commands.openItem).not.toHaveBeenCalled();
  });

  it("says why a search has no hits: none match, the cell did not answer, or it waits offline", async () => {
    drawPalette();
    await said("winter", "Nothing in your library matches.");
    await said("broken", "Your library couldn't be searched.");
    await said("spring", "");
    await screen.findByRole("option", { name: /Plans/u });
    onlineManager.setOnline(false);
    await said("spring trip", NEEDS_CONNECTION);
    expect(screen.queryByRole("option", { name: /Plans/u })).toBeNull();
  });

  it("closes on Escape", async () => {
    const { isOpen } = drawPalette();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(isOpen()).toBe(false);
  });
});
