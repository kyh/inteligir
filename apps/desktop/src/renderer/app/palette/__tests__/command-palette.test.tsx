// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { spellHotkey } from "@repo/editor/hotkey-spelling";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../../global-shortcuts";
import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
  KnowledgeProblemsResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { CommandPalette, PaletteActions } from "../command-palette";
import { searchNotesByFilename } from "../note-search";
import type { NoteSearchSource } from "../note-search";
import {
  defaultRequest,
  makeActions,
  renderWithQueries,
  stubKnowledgeFetch,
} from "./palette-harness";
import type { KnowledgeFakes } from "./palette-harness";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "Welcome.md" },
];

const FILE_PATHS = ENTRIES.filter((entry) => entry.kind === "file").map((entry) => entry.path);

const filenameSource: NoteSearchSource = async (query) => searchNotesByFilename(query, FILE_PATHS);

type PaletteProps = React.ComponentProps<typeof CommandPalette>;

type RenderOverrides = Partial<PaletteProps> & {
  fakes?: KnowledgeFakes;
};

const renderPalette = ({ fakes, ...overrides }: RenderOverrides = {}) => {
  stubKnowledgeFetch(fakes ?? {});
  const actions = makeActions();
  const onOpenChange = vi.fn<PaletteProps["onOpenChange"]>();
  renderWithQueries({
    actions,
    canSync: false,
    entries: ENTRIES,
    modifier: "meta",
    onOpenChange,
    open: true,
    request: defaultRequest,
    searchSource: filenameSource,
    threads: [],
    ...overrides,
  });
  return { actions, onOpenChange };
};

const OUTLINE = [
  { depth: 1, id: "0", path: [0], title: "Plan" },
  { depth: 2, id: "2", path: [2], title: "Week one" },
  { depth: 3, id: "5", path: [5], title: "Monday" },
];

describe("the headings page", () => {
  it("is offered while a note is open, and lists the outline with its levels", () => {
    const goToHeading = vi.fn<PaletteActions["goToHeading"]>();
    const { onOpenChange } = renderPalette({
      actions: { ...makeActions(), goToHeading, listHeadings: () => OUTLINE },
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
      actions: { ...makeActions(), listHeadings: () => OUTLINE },
      request: { nonce: 1, page: "headings" },
    });
    fireEvent.change(screen.getByPlaceholderText("Go to heading…"), {
      target: { value: "week" },
    });
    expect(screen.getByText("Week one")).toBeDefined();
    expect(screen.queryByText("Monday")).toBeNull();
  });

  it("says so with no note open, and hides the root command", () => {
    renderPalette({ request: { nonce: 1, page: "headings" } });
    expect(screen.getByText("Open a note to jump to its headings.")).toBeDefined();
    cleanup();
    renderPalette();
    expect(screen.queryByText("Go to heading…")).toBeNull();
  });
});

describe("pinning from the palette", () => {
  it("offers the one verb the open note needs, and runs it", () => {
    const toggle = vi.fn<() => void>();
    const { onOpenChange } = renderPalette({
      actions: { ...makeActions(), pin: { pinned: false, toggle } },
    });
    expect(screen.queryByText("Unpin note")).toBeNull();
    fireEvent.click(screen.getByText("Pin note"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cleanup();
    renderPalette({ actions: { ...makeActions(), pin: { pinned: true, toggle } } });
    expect(screen.queryByText("Pin note")).toBeNull();
    expect(screen.getByText("Unpin note")).toBeDefined();
  });

  it("offers neither with no note open", () => {
    renderPalette();
    expect(screen.queryByText("Pin note")).toBeNull();
    expect(screen.queryByText("Unpin note")).toBeNull();
  });
});

const EMPTY_FAMILY = { rows: [], total: 0 };

const searchBox = (): HTMLElement => screen.getByPlaceholderText("Search notes or commands…");

const titledSource: NoteSearchSource = async () => [
  { path: "notes/ideas.md", snippet: "…the big idea is…", title: "Big Ideas" },
];

const failingSource: NoteSearchSource = async () => {
  throw new Error("index down");
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let settle: ((value: T) => void) | undefined;
  // oxlint-disable-next-line promise/avoid-new -- a promise settled from outside its executor has no async/await form
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  if (settle === undefined) {
    throw new Error("the promise executor did not run");
  }
  return { promise, resolve: settle };
};

beforeEach(() => {
  stubKnowledgeFetch({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    const source: NoteSearchSource = async (query) => {
      asked.push(query);
      return [{ path: `${query}.md` }];
    };
    renderPalette({ searchSource: source });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await screen.findByText("new.md")).toBeDefined();
    expect(asked).not.toContain("old");
  });

  it("aborts an in-flight query and drops its answer when a newer one arrives", async () => {
    let slowSignal: AbortSignal | undefined;
    const slowReached = deferred<null>();
    const slow = deferred<{ path: string }[]>();
    const source: NoteSearchSource = async (query, signal) => {
      if (query === "old") {
        slowSignal = signal;
        slowReached.resolve(null);
        return await slow.promise;
      }
      return [{ path: "fresh.md" }];
    };
    renderPalette({ searchSource: source });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    // Only once the slow request is in flight does the newer query exercise
    // the abort rather than the debounce.
    await slowReached.promise;
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await screen.findByText("fresh.md")).toBeDefined();
    // the cache drops the superseded read once its observer moved to the new key
    await waitFor(() => {
      expect(slowSignal?.aborted).toBe(true);
    });
    slow.resolve([{ path: "stale.md" }]);
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
    const insertTemplate = vi.fn<NonNullable<PaletteActions["insertTemplate"]>>();
    const { actions } = renderPalette({
      actions: { ...makeActions(), insertTemplate },
      entries: [...ENTRIES, TEMPLATE],
    });
    fireEvent.click(screen.getByText("Insert template…"));
    fireEvent.click(screen.getByText("Meeting"));
    expect(insertTemplate).toHaveBeenCalledWith("templates/Meeting.md");
    expect(actions.insertTemplate).toBeNull();
  });

  it("says where templates come from when the folder is empty", () => {
    renderPalette();
    fireEvent.click(screen.getByText("New note from template…"));
    expect(screen.getByText(/No templates yet/u)).toBeDefined();
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
    expect(screen.queryByText(/^notes$/u)).toBeNull();
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
    expect(screen.getByText(/^notes$/u)).toBeDefined();
  });

  it("opens straight on the page for a requested entry, and hides its own subtree", () => {
    const { actions } = renderPalette({
      request: { nonce: 1, page: "move-to-folder", subject: "notes" },
    });
    expect(screen.getByPlaceholderText("Move to which folder?")).toBeDefined();
    expect(screen.queryByText(/^notes$/u)).toBeNull();
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

const twoMatches =
  (total: number) =>
  (request: KnowledgeMatchesRequest): KnowledgeMatchesResponse => ({
    matches: [
      {
        after: " idea",
        before: "the ",
        column: 4,
        length: request.q.length,
        line: 3,
        ordinal: 0,
        path: "notes/ideas.md",
        text: request.q,
        title: "Big Ideas",
      },
      {
        after: " again",
        before: "",
        column: 0,
        length: request.q.length,
        line: 9,
        ordinal: 1,
        path: "notes/ideas.md",
        text: request.q,
        title: "Big Ideas",
      },
    ],
    total,
  });

const vaultSearchBox = (): HTMLElement => screen.getByPlaceholderText("Search across the vault…");

describe("the search page", () => {
  it("is reached from the root's command and from the page a shortcut names", () => {
    renderPalette();
    fireEvent.click(screen.getByText("Search across the vault…"));
    expect(vaultSearchBox()).toBeDefined();
    cleanup();
    renderPalette({ request: { nonce: 1, page: "search" } });
    expect(vaultSearchBox()).toBeDefined();
  });

  it("lists match rows under their note, and a pick lands on that match", async () => {
    const { actions, onOpenChange } = renderPalette({
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    expect(await screen.findByText("again")).toBeDefined();
    expect(screen.getByText("Big Ideas · notes/ideas.md")).toBeDefined();
    const rows = screen.getAllByText("big");
    expect(rows).toHaveLength(2);
    const [, second] = rows;
    if (second === undefined) {
      throw new Error("the second match row is missing");
    }
    fireEvent.click(second);
    expect(actions.openMatch).toHaveBeenCalledWith(
      expect.objectContaining({ line: 9, ordinal: 1, path: "notes/ideas.md" }),
      "big",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("replaces across the listed notes with the toggles it shows", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await screen.findByText("again");
    fireEvent.click(screen.getByLabelText("Match case"));
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "huge" } });
    fireEvent.click(screen.getByText("Replace all"));
    const [call] = actions.replaceAll.mock.calls;
    expect(call?.[0]).toEqual({
      needle: "big",
      options: { caseSensitive: true, wholeWord: false },
      paths: ["notes/ideas.md"],
      replacement: "huge",
    });
    expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("shows the run's count while it lasts, and Cancel aborts the signal it handed out", async () => {
    const run = deferred<null>();
    let port: Parameters<PaletteActions["replaceAll"]>[1] | null = null;
    const replaceAll = vi.fn<PaletteActions["replaceAll"]>(async (_request, handed) => {
      port = handed;
      await run.promise;
    });
    renderPalette({
      actions: { ...makeActions(), replaceAll },
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await screen.findByText("again");
    fireEvent.click(screen.getByText("Replace all"));
    expect(screen.getByText("Replacing… 0 of 1 notes")).toBeDefined();
    if (port === null) {
      throw new Error("the palette handed out no port");
    }
    const handed: Parameters<PaletteActions["replaceAll"]>[1] = port;
    fireEvent.click(screen.getByText("Cancel"));
    expect(handed.signal?.aborted).toBe(true);
    expect(screen.getByText("Stopping…")).toBeDefined();
    run.resolve(null);
    await waitFor(() => {
      expect(screen.queryByText(/Replacing…/u)).toBeNull();
    });
  });

  it("refuses to replace while the listing is cut, and says so", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(5) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await screen.findByText("again");
    expect(screen.getByText(/2 of 5 matches shown/u)).toBeDefined();
    fireEvent.click(screen.getByText("Replace all"));
    expect(actions.replaceAll).not.toHaveBeenCalled();
  });
});

const someProblems = (): KnowledgeProblemsResponse => ({
  duplicateStems: {
    rows: [{ paths: ["Guide.md", "a/Guide.md"], stem: "Guide" }],
    total: 1,
  },
  missingEmbeds: EMPTY_FAMILY,
  orphans: { rows: [{ path: "Lonely.md", title: "Lonely" }], total: 1 },
  unresolvedLinks: {
    rows: [
      {
        embed: false,
        kind: "wiki",
        line: 3,
        snippet: "See [[Nowhere]].",
        sourcePath: "Welcome.md",
        sourceTitle: "Welcome",
        target: "Nowhere",
      },
    ],
    total: 3,
  },
});

describe("the problems page", () => {
  it("lists each family with its count, and a link row lands on that link", async () => {
    const { actions, onOpenChange } = renderPalette({ fakes: { problems: someProblems } });
    fireEvent.click(screen.getByText("Problems"));
    expect(await screen.findByText("Unresolved links · 3")).toBeDefined();
    expect(screen.getByText("Orphans · 1")).toBeDefined();
    expect(screen.getByText("Duplicate stems · 1")).toBeDefined();
    expect(screen.queryByText(/Missing embeds/u)).toBeNull();
    expect(screen.getByText(/2 more not shown/u)).toBeDefined();
    fireEvent.click(screen.getByText("[[Nowhere]] in Welcome"));
    expect(actions.openProblemLink).toHaveBeenCalledWith("Welcome.md", "Nowhere");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens an orphan or a duplicate as a note, and filters rows by the query", async () => {
    const { actions } = renderPalette({ fakes: { problems: someProblems } });
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
    expect(await screen.findByText(/No problems:/u)).toBeDefined();
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
    for (const row of [...MARK_SHORTCUTS, ...EDITOR_SHORTCUTS, ...FIND_BAR_SHORTCUTS]) {
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
    const { actions } = renderPalette({ request: { nonce: 1, page: "notes" } });
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
