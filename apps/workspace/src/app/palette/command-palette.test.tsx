// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { CommandPalette } from "./command-palette";
import type { PaletteActions } from "./command-palette";

afterEach(cleanup);

const PLANS = "0199a4c2-0000-7000-8000-0000000000c1";

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

// the palette as the workspace holds it: open until it asks to close
const Opened = ({ actions, onClose }: { actions: PaletteActions; onClose: () => void }) => {
  const [open, setOpen] = useState(true);
  return (
    <CommandPalette
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          onClose();
        }
      }}
      actions={actions}
    />
  );
};

const drawPalette = () => {
  const search = vi.fn(
    async (query: string) =>
      await Promise.resolve(
        query === "spring"
          ? [{ itemId: PLANS, score: 1, snippet: "a trip in spring", title: "Plans" }]
          : [],
      ),
  );
  const { library } = fakePageLibrary({ answer: () => ({}), search });
  const actions = spyActions();
  const onClose = vi.fn<() => void>();
  renderOnLibrary(<Opened actions={actions} onClose={onClose} />, library);
  return { actions, onClose, search };
};

// the field Base UI drives, and the option its active descendant names
const field = (): HTMLElement => screen.getByRole("combobox", { name: "Search the library" });

const lit = (): string => {
  const id = field().getAttribute("aria-activedescendant");
  const option = id === null ? null : document.querySelector(`#${id}`);
  return option?.textContent ?? "";
};

describe("the palette", () => {
  it("opens on its field, with the first command lit and named in the footer", async () => {
    drawPalette();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    const list = screen.getByRole("listbox");
    expect(field().getAttribute("aria-controls")).toBe(list.id);
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "New note",
      "Save a link…",
      expect.stringContaining("Ask the agent"),
      "Tidy my library",
      expect.stringContaining("Settings"),
    ]);
    expect(lit()).toBe("New note");
    expect(screen.getByRole("group", { name: "Commands" })).toBeDefined();
  });

  it("moves the light with the arrows while the field keeps focus, and runs the lit row on Enter", async () => {
    const { actions, onClose } = drawPalette();
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
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("searches the replica as the field changes, and opens a hit on the words it was found by", async () => {
    const { actions, search } = drawPalette();
    fireEvent.change(field(), { target: { value: "spring" } });
    const hit = await screen.findByRole("option", { name: /Plans/u });
    expect(search).toHaveBeenCalledWith("spring", 20);
    expect(hit.dataset.searchHit).toBe(PLANS);
    expect(within(hit).getByText("a trip in spring")).toBeDefined();
    // the hits come first, so the light lands on the first of them
    await waitFor(() => {
      expect(lit()).toContain("Plans");
    });
    expect(screen.getByText("Open")).toBeDefined();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(actions.openHit).toHaveBeenCalledWith(PLANS, "spring");
  });

  it("offers to save a typed web address", async () => {
    const { actions } = drawPalette();
    fireEvent.change(field(), { target: { value: "https://example.com/a" } });
    fireEvent.click(await screen.findByRole("option", { name: "Save this link" }));
    expect(actions.saveLink).toHaveBeenCalledWith("https://example.com/a");
  });

  it("closes on Escape", async () => {
    const { onClose } = drawPalette();
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
