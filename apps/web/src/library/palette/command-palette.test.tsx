import { createORPCErrorFromJson } from "@orpc/client";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall } from "../test-support/fake-page-library";
import { CommandPalette } from "./command-palette";
import type { PaletteActions } from "./command-palette";

afterEach(() => {
  onlineManager.setOnline(true);
});

const spyActions = () =>
  ({
    askAgent: vi.fn<() => void>(),
    askSaveLink: vi.fn<() => void>(),
    newNote: vi.fn<() => void>(),
    openHit: vi.fn<() => void>(),
    openSettings: vi.fn<() => void>(),
    saveLink: vi.fn<() => void>(),
    startTidy: vi.fn<() => void>(),
  }) satisfies PaletteActions;

const WORDS = z.object({ words: z.string() });

// the cell's full-text search, which answers a listing's page for the words asked: an untitled
// item for one, a titled one with the passage that matched for another
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
      return { items: hits.get(words) ?? [], kindCounts: {}, nextCursor: null, total: 0 };
    },
    cell,
  });
  const actions = spyActions();
  library.workspace.setPaletteOpen(true);
  renderOnLibrary(<CommandPalette actions={actions} />, library);
  return {
    actions,
    calls,
    isOpen: () => library.workspace.store.getState().paletteOpen,
    plans,
  };
};

const searches = (calls: readonly CellCall[]): unknown[] =>
  calls.filter((call) => call.path === "library.listing.page").map((call) => call.input);

// the field Base UI drives, and the option its active descendant names
const field = (): HTMLElement => screen.getByRole("combobox", { name: "Search the library" });

const lit = (): string => {
  const id = field().getAttribute("aria-activedescendant");
  const option = id === null ? null : document.querySelector(`#${id}`);
  return option?.textContent ?? "";
};

// the words typed, and the line under the field once the palette says it
const said = async (words: string, line: string): Promise<void> => {
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
    const { actions, isOpen } = drawPalette();
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
    expect(actions.askSaveLink).toHaveBeenCalledOnce();
    expect(actions.newNote).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
  });

  it("searches the cell as the field changes, and opens a hit on the words it was found by", async () => {
    const { actions, calls, plans } = drawPalette();
    fireEvent.change(field(), { target: { value: "spring" } });
    const hit = await screen.findByRole("option", { name: /Plans/u });
    expect(searches(calls)).toStrictEqual([
      { limit: 20, query: { deleted: false, sort: "relevance" }, words: "spring" },
    ]);
    expect(hit.dataset.searchHit).toBe(plans);
    expect(within(hit).getByText("a trip in spring")).toBeDefined();
    // the hits come first, so the light lands on the first of them
    await waitFor(() => {
      expect(lit()).toContain("Plans");
    });
    expect(screen.getByText("Open")).toBeDefined();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(actions.openHit).toHaveBeenCalledWith(plans, "spring");
  });

  it("calls a hit with no title Untitled", async () => {
    drawPalette();
    fireEvent.change(field(), { target: { value: "#todo" } });
    await expect(screen.findByRole("option", { name: /Untitled/u })).resolves.toBeDefined();
  });

  it("offers to save a typed web address", async () => {
    const { actions } = drawPalette();
    fireEvent.change(field(), { target: { value: "https://example.com/a" } });
    fireEvent.click(await screen.findByRole("option", { name: "Save this link" }));
    expect(actions.saveLink).toHaveBeenCalledWith("https://example.com/a");
  });

  it("lights Save over the hits for a pasted web address, so Enter saves it", async () => {
    const { actions } = drawPalette();
    fireEvent.change(field(), { target: { value: "https://example.com/spring" } });
    await screen.findByRole("option", { name: /Plans/u });
    await waitFor(() => {
      expect(lit()).toBe("Save this link");
    });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(actions.saveLink).toHaveBeenCalledWith("https://example.com/spring");
    expect(actions.openHit).not.toHaveBeenCalled();
  });

  it("says why a search has no hits: none match, the cell did not answer, or it waits offline", async () => {
    drawPalette();
    await said("winter", "Nothing in your library matches.");
    await said("broken", "Your library couldn't be searched.");
    await said("spring", "");
    await screen.findByRole("option", { name: /Plans/u });
    onlineManager.setOnline(false);
    // the hits typed before answer other words
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
