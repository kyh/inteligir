// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/server-contract/vault";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteActions } from "../command-palette";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/ideas.md", size: 5 },
  { kind: "file", path: "Welcome.md", size: 20 },
];

function makeActions(): PaletteActions {
  return {
    openNote: vi.fn(),
    newNote: vi.fn(),
    openDailyNote: vi.fn(),
    syncNow: vi.fn(),
    openSettings: vi.fn(),
  };
}

function renderPalette(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const actions = makeActions();
  const onOpenChange = vi.fn();
  render(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      entries={ENTRIES}
      canSync={false}
      actions={actions}
      {...overrides}
    />,
  );
  return { actions, onOpenChange };
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText("Search notes or commands…");
}

afterEach(cleanup);

describe("note search", () => {
  it("lists notes and opens the picked one", () => {
    const { actions, onOpenChange } = renderPalette();
    fireEvent.click(screen.getByText("Welcome.md"));
    expect(actions.openNote).toHaveBeenCalledWith("Welcome.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("narrows the note list as the query types", () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "ideas" } });
    expect(screen.getByText("notes/ideas.md")).toBeDefined();
    expect(screen.queryByText("Welcome.md")).toBeNull();
  });

  it("matches loosely (subsequence) on the path", () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "nids" } });
    expect(screen.getByText("notes/ideas.md")).toBeDefined();
  });
});

describe("commands", () => {
  it("runs New note at the vault root", () => {
    const { actions } = renderPalette();
    fireEvent.click(screen.getByText("New note"));
    expect(actions.newNote).toHaveBeenCalledWith("");
  });

  it("filters commands by the query", () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "daily" } });
    expect(screen.getByText("Daily note")).toBeDefined();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("runs the daily note command", () => {
    const { actions } = renderPalette();
    fireEvent.click(screen.getByText("Daily note"));
    expect(actions.openDailyNote).toHaveBeenCalled();
  });

  it("hides Sync now without a remote and shows it with one", () => {
    renderPalette();
    expect(screen.queryByText("Sync now")).toBeNull();
    cleanup();
    const { actions } = renderPalette({ canSync: true });
    fireEvent.click(screen.getByText("Sync now"));
    expect(actions.syncNow).toHaveBeenCalled();
  });

  it("opens settings", () => {
    const { actions } = renderPalette();
    fireEvent.click(screen.getByText("Settings"));
    expect(actions.openSettings).toHaveBeenCalled();
  });
});

describe("the new-note-in-folder page", () => {
  it("stays open, lists folders and creates in the picked one", () => {
    const { actions, onOpenChange } = renderPalette();
    fireEvent.click(screen.getByText("New note in folder…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("Vault root")).toBeDefined();
    fireEvent.click(screen.getByText("notes/daily"));
    expect(actions.newNote).toHaveBeenCalledWith("notes/daily");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters folders by the query and always keeps the root", () => {
    renderPalette();
    fireEvent.click(screen.getByText("New note in folder…"));
    fireEvent.change(screen.getByPlaceholderText("New note in which folder?"), {
      target: { value: "daily" },
    });
    expect(screen.getByText("notes/daily")).toBeDefined();
    expect(screen.queryByText(/^notes$/)).toBeNull();
    expect(screen.getByText("Vault root")).toBeDefined();
  });
});
