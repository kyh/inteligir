// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey, spellHotkey } from "../../global-shortcuts";
import { CommandPalette, type PaletteActions } from "../command-palette";
import type { MatchSource } from "../match-source";
import { searchNotesByFilename, type NoteSearchSource } from "../note-search";
import type { ProblemSource } from "../problem-source";

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
    newNoteFromTemplate: vi.fn(),
    openDailyNote: vi.fn(),
    openThread: vi.fn(),
    syncNow: vi.fn(),
    openSettings: vi.fn(),
    openDeletedNotes: vi.fn(),
    findInNote: null,
    insertTemplate: null,
    exportPdf: null,
    moveNote: vi.fn(),
    pinNote: null,
    unpinNote: null,
    openMatch: vi.fn(),
    replaceAll: vi.fn(),
    listHeadings: null,
    goToHeading: vi.fn(),
    openProblemLink: vi.fn(),
  };
}

const OUTLINE = [
  { id: "0", path: [0], depth: 1, title: "Plan" },
  { id: "2", path: [2], depth: 2, title: "Week one" },
  { id: "5", path: [5], depth: 3, title: "Monday" },
];

describe("the headings page", () => {
  it("is offered while a note is open, and lists the outline with its levels", () => {
    const goToHeading = vi.fn();
    const { onOpenChange } = renderPalette({
      actions: { ...makeActions(), listHeadings: () => OUTLINE, goToHeading },
    });
    fireEvent.click(screen.getByText("Go to heading…"));
    expect(screen.getByPlaceholderText("Go to heading…")).toBeDefined();
    expect(screen.getByText("Week one")).toBeDefined();
    expect(screen.getByText("H3")).toBeDefined();
    fireEvent.click(screen.getByText("Monday"));
    expect(goToHeading).toHaveBeenCalledWith(OUTLINE[2]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens straight on the page a shortcut names, and filters by title", () => {
    renderPalette({
      initialPage: "headings",
      actions: { ...makeActions(), listHeadings: () => OUTLINE },
    });
    fireEvent.change(screen.getByPlaceholderText("Go to heading…"), {
      target: { value: "week" },
    });
    expect(screen.getByText("Week one")).toBeDefined();
    expect(screen.queryByText("Monday")).toBeNull();
  });

  it("says so with no note open, and hides the root command", () => {
    renderPalette({ initialPage: "headings" });
    expect(screen.getByText("Open a note to jump to its headings.")).toBeDefined();
    cleanup();
    renderPalette();
    expect(screen.queryByText("Go to heading…")).toBeNull();
  });
});

describe("pinning from the palette", () => {
  it("offers the one verb the open note needs, and runs it", () => {
    const pinNote = vi.fn();
    const { onOpenChange } = renderPalette({ actions: { ...makeActions(), pinNote } });
    expect(screen.queryByText("Unpin note")).toBeNull();
    fireEvent.click(screen.getByText("Pin note"));
    expect(pinNote).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers neither with no note open", () => {
    renderPalette();
    expect(screen.queryByText("Pin note")).toBeNull();
    expect(screen.queryByText("Unpin note")).toBeNull();
  });
});

const noMatches: MatchSource = () => Promise.resolve({ matches: [], total: 0 });

const EMPTY_FAMILY = { rows: [], total: 0 };
const noProblems: ProblemSource = () =>
  Promise.resolve({
    unresolvedLinks: EMPTY_FAMILY,
    missingEmbeds: EMPTY_FAMILY,
    orphans: EMPTY_FAMILY,
    duplicateStems: EMPTY_FAMILY,
  });

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
      matchSource={noMatches}
      problemSource={noProblems}
      canSync={false}
      actions={actions}
      modifier="meta"
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

const TEMPLATE: VaultEntry = { kind: "file", path: "templates/Meeting.md" };

describe("the template pages", () => {
  it("lists templates by stem and creates a note from the picked one", () => {
    const { actions, onOpenChange } = renderPalette({ entries: [...ENTRIES, TEMPLATE] });
    fireEvent.click(screen.getByText("New note from template…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText("Meeting"));
    expect(actions.newNoteFromTemplate).toHaveBeenCalledWith("templates/Meeting.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers Insert template only over an open note, and inserts the picked one", () => {
    renderPalette({ entries: [...ENTRIES, TEMPLATE] });
    expect(screen.queryByText("Insert template…")).toBeNull();
    cleanup();
    const insertTemplate = vi.fn();
    const { actions } = renderPalette({
      entries: [...ENTRIES, TEMPLATE],
      actions: { ...makeActions(), insertTemplate },
    });
    fireEvent.click(screen.getByText("Insert template…"));
    fireEvent.click(screen.getByText("Meeting"));
    expect(insertTemplate).toHaveBeenCalledWith("templates/Meeting.md");
    expect(actions.insertTemplate).toBeNull();
  });

  it("says where templates come from when the folder is empty", () => {
    renderPalette();
    fireEvent.click(screen.getByText("New note from template…"));
    expect(screen.getByText(/No templates yet/)).toBeDefined();
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

describe("the move-to-folder page", () => {
  it("is offered for the open note and moves it into the picked folder", () => {
    const { actions, onOpenChange } = renderPalette({ openNotePath: "Welcome.md" });
    fireEvent.click(screen.getByText("Move note to folder…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText("notes/daily"));
    expect(actions.moveNote).toHaveBeenCalledWith("Welcome.md", "notes/daily");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the folder the note is already in, and the root when that is it", () => {
    renderPalette({ openNotePath: "Welcome.md" });
    fireEvent.click(screen.getByText("Move note to folder…"));
    expect(screen.queryByText("Vault root")).toBeNull();
    expect(screen.getByText(/^notes$/)).toBeDefined();
  });

  it("opens straight on the page for a requested entry, and hides its own subtree", () => {
    const { actions } = renderPalette({ moveRequest: "notes" });
    expect(screen.getByPlaceholderText("Move to which folder?")).toBeDefined();
    expect(screen.queryByText(/^notes$/)).toBeNull();
    expect(screen.queryByText("notes/daily")).toBeNull();
    expect(screen.queryByText("Vault root")).toBeNull();
    expect(screen.getByText("No folder it can move to.")).toBeDefined();
    expect(actions.moveNote).not.toHaveBeenCalled();
  });

  it("is absent from the root page with no note open", () => {
    renderPalette();
    expect(screen.queryByText("Move note to folder…")).toBeNull();
  });
});

const twoMatches = (total: number): MatchSource => {
  return (request) =>
    Promise.resolve({
      matches: [
        {
          path: "notes/ideas.md",
          title: "Big Ideas",
          ordinal: 0,
          line: 3,
          column: 4,
          length: request.q.length,
          before: "the ",
          text: request.q,
          after: " idea",
        },
        {
          path: "notes/ideas.md",
          title: "Big Ideas",
          ordinal: 1,
          line: 9,
          column: 0,
          length: request.q.length,
          before: "",
          text: request.q,
          after: " again",
        },
      ],
      total,
    });
};

function vaultSearchBox(): HTMLElement {
  return screen.getByPlaceholderText("Search across the vault…");
}

describe("the search page", () => {
  it("is reached from the root's command and from the page a shortcut names", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Search across the vault…"));
    expect(vaultSearchBox()).toBeDefined();
    cleanup();
    renderPalette({ initialPage: "search" });
    expect(vaultSearchBox()).toBeDefined();
  });

  it("lists match rows under their note, and a pick lands on that match", async () => {
    const { actions, onOpenChange } = renderPalette({
      initialPage: "search",
      matchSource: twoMatches(2),
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    expect(await screen.findByText("again")).toBeDefined();
    expect(screen.getByText("Big Ideas · notes/ideas.md")).toBeDefined();
    const rows = screen.getAllByText("big");
    expect(rows).toHaveLength(2);
    const second = rows[1];
    if (second === undefined) throw new Error("the second match row is missing");
    fireEvent.click(second);
    expect(actions.openMatch).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes/ideas.md", ordinal: 1, line: 9 }),
      "big",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("replaces across the listed notes with the toggles it shows", async () => {
    const { actions } = renderPalette({ initialPage: "search", matchSource: twoMatches(2) });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await screen.findByText("again");
    fireEvent.click(screen.getByLabelText("Match case"));
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "huge" } });
    fireEvent.click(screen.getByText("Replace all"));
    expect(actions.replaceAll).toHaveBeenCalledWith({
      needle: "big",
      replacement: "huge",
      options: { caseSensitive: true, wholeWord: false },
      paths: ["notes/ideas.md"],
    });
  });

  it("refuses to replace while the listing is cut, and says so", async () => {
    const { actions } = renderPalette({ initialPage: "search", matchSource: twoMatches(5) });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await screen.findByText("again");
    expect(screen.getByText(/2 of 5 matches shown/)).toBeDefined();
    fireEvent.click(screen.getByText("Replace all"));
    expect(actions.replaceAll).not.toHaveBeenCalled();
  });
});

const someProblems: ProblemSource = () =>
  Promise.resolve({
    unresolvedLinks: {
      rows: [
        {
          sourcePath: "Welcome.md",
          sourceTitle: "Welcome",
          target: "Nowhere",
          line: 3,
          snippet: "See [[Nowhere]].",
          kind: "wiki",
          embed: false,
        },
      ],
      total: 3,
    },
    missingEmbeds: EMPTY_FAMILY,
    orphans: { rows: [{ path: "Lonely.md", title: "Lonely" }], total: 1 },
    duplicateStems: {
      rows: [{ stem: "Guide", paths: ["Guide.md", "a/Guide.md"] }],
      total: 1,
    },
  });

describe("the problems page", () => {
  it("lists each family with its count, and a link row lands on that link", async () => {
    const { actions, onOpenChange } = renderPalette({ problemSource: someProblems });
    fireEvent.click(screen.getByText("Problems"));
    expect(await screen.findByText("Unresolved links · 3")).toBeDefined();
    expect(screen.getByText("Orphans · 1")).toBeDefined();
    expect(screen.getByText("Duplicate stems · 1")).toBeDefined();
    expect(screen.queryByText(/Missing embeds/)).toBeNull();
    expect(screen.getByText(/2 more not shown/)).toBeDefined();
    fireEvent.click(screen.getByText("[[Nowhere]] in Welcome"));
    expect(actions.openProblemLink).toHaveBeenCalledWith("Welcome.md", "Nowhere");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens an orphan or a duplicate as a note, and filters rows by the query", async () => {
    const { actions } = renderPalette({ problemSource: someProblems });
    fireEvent.click(screen.getByText("Problems"));
    await screen.findByText("Lonely");
    fireEvent.change(screen.getByPlaceholderText("Filter problems…"), {
      target: { value: "a/guide" },
    });
    expect(screen.queryByText("Lonely")).toBeNull();
    fireEvent.click(screen.getByText("a/Guide.md"));
    expect(actions.openNote).toHaveBeenCalledWith("a/Guide.md");
    expect(actions.openProblemLink).not.toHaveBeenCalled();
  });

  it("says when the vault is clean", async () => {
    renderPalette();
    fireEvent.click(screen.getByText("Problems"));
    expect(await screen.findByText(/No problems:/)).toBeDefined();
  });
});

describe("the keyboard shortcuts page", () => {
  it("lists every row of every table, spelled for the keyboard the palette was given", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Keyboard shortcuts"));
    expect(screen.getByPlaceholderText("Filter shortcuts…")).toBeDefined();
    for (const row of GLOBAL_SHORTCUTS) {
      expect(screen.getByText(row.label)).toBeDefined();
      expect(screen.getByText(spellHotkey(globalShortcutHotkey(row), "meta"))).toBeDefined();
    }
    for (const row of [...EDITOR_SHORTCUTS, ...FIND_BAR_SHORTCUTS]) {
      expect(screen.getByText(row.label)).toBeDefined();
      expect(screen.getByText(spellHotkey(row.hotkey, "meta"))).toBeDefined();
    }
  });

  it("filters by label or chord", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Keyboard shortcuts"));
    fireEvent.change(screen.getByPlaceholderText("Filter shortcuts…"), {
      target: { value: "⇧⌘G" },
    });
    expect(screen.getByText("Previous match")).toBeDefined();
    expect(screen.queryByText("Next match")).toBeNull();
  });
});

describe("a command's binding", () => {
  it("is the global table's row, not a literal", () => {
    renderPalette();
    expect(screen.getByText("⌘D")).toBeDefined();
    expect(screen.getByText("⇧⌘F")).toBeDefined();
    cleanup();
    renderPalette({ modifier: "ctrl" });
    expect(screen.getByText("Ctrl+D")).toBeDefined();
    expect(screen.getByText("Ctrl+Shift+F")).toBeDefined();
  });
});

describe("the quick switcher (⌘O)", () => {
  it("is the root with its commands folded away", async () => {
    const { actions } = renderPalette({ initialPage: "notes" });
    const box = screen.getByPlaceholderText("Open a note…");
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
    fireEvent.change(box, { target: { value: "welcome" } });
    await waitFor(() => {
      expect(screen.getByText("Welcome.md")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Welcome.md"));
    expect(actions.openNote).toHaveBeenCalledWith("Welcome.md");
  });
});
