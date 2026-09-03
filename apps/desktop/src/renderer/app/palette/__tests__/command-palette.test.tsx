// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteActions } from "../command-palette";
import { searchNotesByFilename, type NoteSearchSource } from "../note-search";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "Welcome.md" },
];

const FILE_PATHS = ENTRIES.filter((entry) => entry.kind === "file").map((entry) => entry.path);

const filenameSource: NoteSearchSource = (query) =>
  Promise.resolve(searchNotesByFilename(query, FILE_PATHS));

function makeActions(): PaletteActions {
  return {
    openNote: vi.fn(),
    newNote: vi.fn(),
    openDailyNote: vi.fn(),
    openThread: vi.fn(),
    syncNow: vi.fn(),
    openSettings: vi.fn(),
    openDeletedNotes: vi.fn(),
    exportPdf: null,
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
      threads={[]}
      searchSource={filenameSource}
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

const titledSource: NoteSearchSource = () =>
  Promise.resolve([{ path: "notes/ideas.md", title: "Big Ideas", snippet: "…the big idea is…" }]);

const failingSource: NoteSearchSource = () => Promise.reject(new Error("index down"));

const noop = (): void => {};

afterEach(cleanup);

describe("note search", () => {
  it("lists notes from the source and opens the picked one", async () => {
    const { actions, onOpenChange } = renderPalette();
    fireEvent.click(await screen.findByText("Welcome.md"));
    expect(actions.openNote).toHaveBeenCalledWith("Welcome.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("narrows the note list as the query types", async () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "ideas" } });
    expect(await screen.findByText("notes/ideas.md")).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("Welcome.md")).toBeNull();
    });
  });

  it("renders full-text hits with title and path, and their pick opens the path", async () => {
    const { actions } = renderPalette({ searchSource: titledSource });
    fireEvent.change(searchBox(), { target: { value: "big" } });
    fireEvent.click(await screen.findByText("Big Ideas"));
    expect(actions.openNote).toHaveBeenCalledWith("notes/ideas.md");
  });

  it("debounces: a query superseded within the window never reaches the source", async () => {
    const asked: string[] = [];
    const source: NoteSearchSource = (query) => {
      asked.push(query);
      return Promise.resolve([{ path: `${query}.md` }]);
    };
    renderPalette({ searchSource: source });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await screen.findByText("new.md")).toBeDefined();
    expect(asked).not.toContain("old");
  });

  it("aborts an in-flight query and drops its answer when a newer one arrives", async () => {
    let releaseSlow: (hits: { path: string }[]) => void = noop;
    let slowSignal: AbortSignal | undefined;
    let slowAsked: () => void = noop;
    const slowReached = new Promise<void>((resolve) => {
      slowAsked = resolve;
    });
    const slow = new Promise<{ path: string }[]>((resolve) => {
      releaseSlow = resolve;
    });
    const source: NoteSearchSource = (query, signal) => {
      if (query === "old") {
        slowSignal = signal;
        slowAsked();
        return slow;
      }
      return Promise.resolve([{ path: "fresh.md" }]);
    };
    renderPalette({ searchSource: source });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    // Only once the slow request is in flight does the newer query exercise
    // the abort rather than the debounce.
    await slowReached;
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await screen.findByText("fresh.md")).toBeDefined();
    expect(slowSignal?.aborted).toBe(true);
    releaseSlow([{ path: "stale.md" }]);
    await waitFor(() => {
      expect(screen.queryByText("stale.md")).toBeNull();
    });
  });

  it("shows an empty list when the source fails", async () => {
    renderPalette({ searchSource: failingSource });
    fireEvent.change(searchBox(), { target: { value: "anything" } });
    await waitFor(() => {
      expect(screen.queryByText("Welcome.md")).toBeNull();
    });
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
