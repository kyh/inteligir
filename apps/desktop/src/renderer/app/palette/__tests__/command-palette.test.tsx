// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENT_SHORTCUTS } from "@repo/editor/comments/comment-kit";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { hotkeyCaps } from "@repo/ui/lib/hotkey-spelling";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../../global-shortcuts";
import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
  KnowledgeProblemsResponse,
  KnowledgeSearchResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import { ChangeBatch } from "../../workspace-context";
import type { CommandPalette, PaletteActions, PaletteNote } from "../command-palette";
import {
  defaultRequest,
  makeActions,
  makeNote,
  renderWithQueries,
  stubPaletteFetch,
} from "./palette-harness";
import type { PaletteFakes } from "./palette-harness";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "Welcome.md" },
];

type PaletteProps = React.ComponentProps<typeof CommandPalette>;

type RenderOverrides = Partial<PaletteProps> & {
  fakes?: PaletteFakes;
  // the open note, folded into the actions the render hands back
  note?: PaletteNote;
};

const renderPalette = ({ fakes, note, ...overrides }: RenderOverrides = {}) => {
  stubPaletteFetch(fakes ?? {});
  const actions = { ...makeActions(), note: note ?? null };
  const onOpenChange = vi.fn<PaletteProps["onOpenChange"]>();
  const props: PaletteProps = {
    actions,
    canSync: false,
    entries: ENTRIES,
    modifier: "meta",
    onOpenChange,
    open: true,
    request: defaultRequest,
    threads: [],
    ...overrides,
  };
  const { queryClient, rerender } = renderWithQueries(props);
  return { actions, onOpenChange, props, queryClient, rerender };
};

// The footer names the row Enter would run, so a row's label is on screen twice. Every row
// assertion scopes itself to the list; the toolbar's own controls stay on `screen`.
const rows = () => within(screen.getByRole("listbox"));

// A chord draws one box per key, so it is read off the row's own caps rather than as one string.
const chords = (): string[][] =>
  [...screen.getByRole("listbox").querySelectorAll("[data-slot='command-shortcut']")].map((kbd) =>
    [...kbd.children].map((cap) => cap.textContent ?? ""),
  );

const OUTLINE = [
  { depth: 1, id: "0", path: [0], title: "Plan" },
  { depth: 2, id: "2", path: [2], title: "Week one" },
  { depth: 3, id: "5", path: [5], title: "Monday" },
];

describe("the headings page", () => {
  it("is offered while a note is open, and lists the outline with its levels", () => {
    const { actions, onOpenChange } = renderPalette({
      note: { ...makeNote(), listHeadings: () => OUTLINE },
    });
    fireEvent.click(rows().getByText("Go to heading…"));
    expect(screen.getByPlaceholderText("Go to heading…")).toBeDefined();
    expect(rows().getByText("Week one")).toBeDefined();
    expect(rows().getByText("H3")).toBeDefined();
    fireEvent.click(rows().getByText("Monday"));
    expect(actions.goToHeading).toHaveBeenCalledWith(OUTLINE[2]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens straight on the page a shortcut names, and filters by title", () => {
    renderPalette({
      note: makeNote(),
      request: { nonce: 1, outline: OUTLINE, page: "headings" },
    });
    fireEvent.change(screen.getByPlaceholderText("Go to heading…"), {
      target: { value: "week" },
    });
    expect(rows().getByText("Week one")).toBeDefined();
    expect(rows().queryByText("Monday")).toBeNull();
  });

  it("says so with no note open, and hides the root command", () => {
    renderPalette({ request: { nonce: 1, outline: [], page: "headings" } });
    expect(rows().getByText("Open a note to jump to its headings.")).toBeDefined();
    cleanup();
    renderPalette();
    expect(rows().queryByText("Go to heading…")).toBeNull();
  });

  it("walks the outline once as the page opens, never as it renders", () => {
    const note = { ...makeNote(), listHeadings: vi.fn<PaletteNote["listHeadings"]>(() => OUTLINE) };
    renderPalette({ note });
    expect(note.listHeadings).not.toHaveBeenCalled();
    fireEvent.click(rows().getByText("Go to heading…"));
    for (const value of ["w", "we", "wee", "week"]) {
      fireEvent.change(screen.getByPlaceholderText("Go to heading…"), { target: { value } });
    }
    expect(rows().getByText("Week one")).toBeDefined();
    expect(note.listHeadings).toHaveBeenCalledTimes(1);
  });
});

describe("pinning from the palette", () => {
  it("offers the one verb the open note needs, and runs it", () => {
    const note = makeNote();
    const { onOpenChange } = renderPalette({ note });
    expect(rows().queryByText("Unpin note")).toBeNull();
    fireEvent.click(rows().getByText("Pin note"));
    expect(note.togglePin).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cleanup();
    renderPalette({ note: { ...makeNote(), pinned: true } });
    expect(rows().queryByText("Pin note")).toBeNull();
    expect(rows().getByText("Unpin note")).toBeDefined();
  });

  it("offers neither with no note open", () => {
    renderPalette();
    expect(rows().queryByText("Pin note")).toBeNull();
    expect(rows().queryByText("Unpin note")).toBeNull();
  });
});

const EMPTY_FAMILY = { rows: [], total: 0 };

const searchBox = (): HTMLElement => screen.getByPlaceholderText("Search notes or commands…");

const vaultSearchBox = (): HTMLElement => screen.getByPlaceholderText("Search across the vault…");

const replaceButton = (): HTMLElement => screen.getByRole("button", { name: "Replace all" });

const indexHit = (path: string, title = ""): KnowledgeSearchResponse["results"][number] => ({
  path,
  score: 1,
  snippet: "",
  title,
});

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
  stubPaletteFetch({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("note search", () => {
  it("lists notes from the listing and opens the picked one", async () => {
    const { actions, onOpenChange } = renderPalette();
    fireEvent.click(await rows().findByText("Welcome.md"));
    expect(actions.openNote).toHaveBeenCalledWith("Welcome.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("answers an empty box from the listing, asking the index nothing", async () => {
    const asked: string[] = [];
    renderPalette({
      fakes: {
        search: (request) => {
          asked.push(request.q);
          return { results: [] };
        },
      },
    });
    expect(await rows().findByText("Welcome.md")).toBeDefined();
    expect(asked).toEqual([]);
  });

  it("lists only what the user wrote, never a dot-folder's notes", async () => {
    renderPalette({ entries: [...ENTRIES, { kind: "file", path: ".github/x.md" }] });
    expect(await rows().findByText("Welcome.md")).toBeDefined();
    expect(rows().queryByText(".github/x.md")).toBeNull();
  });

  it("lists a note created between two opens", async () => {
    const { props, rerender } = renderPalette();
    expect(await rows().findByText("Welcome.md")).toBeDefined();
    rerender({ ...props, open: false });
    rerender({
      ...props,
      entries: [...ENTRIES, { kind: "file", path: "Fresh.md" }],
      request: { ...defaultRequest, nonce: 2 },
    });
    expect(await rows().findByText("Fresh.md")).toBeDefined();
  });

  it("narrows the note list as the query types", async () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "ideas" } });
    expect(await rows().findByText("notes/ideas.md")).toBeDefined();
    await waitFor(() => {
      expect(rows().queryByText("Welcome.md")).toBeNull();
    });
  });

  it("renders full-text hits with title and path, and their pick opens the path", async () => {
    const { actions } = renderPalette({
      fakes: { search: () => ({ results: [indexHit("notes/ideas.md", "Big Ideas")] }) },
    });
    fireEvent.change(searchBox(), { target: { value: "big" } });
    fireEvent.click(await rows().findByText("Big Ideas"));
    expect(actions.openNote).toHaveBeenCalledWith("notes/ideas.md");
  });

  it("re-reads the index's hits when the bus sweeps the vault", async () => {
    let title = "Before";
    const { queryClient } = renderPalette({
      fakes: { search: () => ({ results: [indexHit("notes/ideas.md", title)] }) },
    });
    fireEvent.change(searchBox(), { target: { value: "idea" } });
    expect(await rows().findByText("Before")).toBeDefined();
    title = "After";
    act(() => {
      const batch = new ChangeBatch();
      batch.add({ changes: ["files-changed"], entity: "vault", type: "changed" });
      batch.apply(queryClient, vi.fn(), vi.fn());
    });
    expect(await rows().findByText("After")).toBeDefined();
  });

  it("falls back to the filenames when the index refuses", async () => {
    // the client logs every refused call in dev
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPalette({
      fakes: {
        search: (request) => {
          if (request.q === "big") {
            return { results: [indexHit("notes/ideas.md", "Big Ideas")] };
          }
          throw new Error("index down");
        },
      },
    });
    fireEvent.change(searchBox(), { target: { value: "big" } });
    expect(await rows().findByText("Big Ideas")).toBeDefined();
    fireEvent.change(searchBox(), { target: { value: "ideas" } });
    // the last answer stands in while the read is in flight, so only the refusal clears it
    await waitFor(() => {
      expect(rows().queryByText("Big Ideas")).toBeNull();
    });
    expect(rows().getByText("notes/ideas.md")).toBeDefined();
    expect(logged).toHaveBeenCalled();
  });

  it("debounces: a query superseded within the window never reaches the index", async () => {
    const asked: string[] = [];
    renderPalette({
      fakes: {
        search: (request) => {
          asked.push(request.q);
          return { results: [indexHit(`${request.q}.md`)] };
        },
      },
    });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await rows().findByText("new.md")).toBeDefined();
    expect(asked).not.toContain("old");
  });

  it("aborts an in-flight query and drops its answer when a newer one arrives", async () => {
    let slowSignal: AbortSignal | undefined;
    const slowReached = deferred<null>();
    const slow = deferred<KnowledgeSearchResponse>();
    renderPalette({
      fakes: {
        search: async (request, signal) => {
          if (request.q === "old") {
            slowSignal = signal;
            slowReached.resolve(null);
            return await slow.promise;
          }
          return { results: [indexHit("fresh.md")] };
        },
      },
    });
    fireEvent.change(searchBox(), { target: { value: "old" } });
    // Only once the slow request is in flight does the newer query exercise
    // the abort rather than the debounce.
    await slowReached.promise;
    fireEvent.change(searchBox(), { target: { value: "new" } });
    expect(await rows().findByText("fresh.md")).toBeDefined();
    // the cache drops the superseded read once its observer moved to the new key
    await waitFor(() => {
      expect(slowSignal?.aborted).toBe(true);
    });
    slow.resolve({ results: [indexHit("stale.md")] });
    await waitFor(() => {
      expect(rows().queryByText("stale.md")).toBeNull();
    });
  });
});

describe("commands", () => {
  it("runs New note at the vault root", () => {
    const { actions } = renderPalette();
    fireEvent.click(rows().getByText("New note"));
    expect(actions.newNote).toHaveBeenCalledWith("");
  });

  it("filters commands by the query", () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "daily" } });
    expect(rows().getByText("Daily note")).toBeDefined();
    expect(rows().queryByText("Settings")).toBeNull();
  });

  it("runs the daily note command", () => {
    const { actions } = renderPalette();
    fireEvent.click(rows().getByText("Daily note"));
    expect(actions.openDailyNote).toHaveBeenCalled();
  });

  it("hides Sync now without a remote and shows it with one", () => {
    renderPalette();
    expect(rows().queryByText("Sync now")).toBeNull();
    cleanup();
    const { actions } = renderPalette({ canSync: true });
    fireEvent.click(rows().getByText("Sync now"));
    expect(actions.syncNow).toHaveBeenCalled();
  });

  it("opens settings", () => {
    const { actions } = renderPalette();
    fireEvent.click(rows().getByText("Settings"));
    expect(actions.openSettings).toHaveBeenCalled();
  });
});

const ACTION: Thread = {
  activeTurnId: null,
  archivedAt: null,
  createdAt: 1,
  id: "thr_1",
  originDocPath: "Welcome.md",
  providerId: null,
  runsElsewhere: false,
  status: "idle",
  title: "Tidy the intro",
  updatedAt: 1,
};

describe("the actions page", () => {
  it("opens the picked action", () => {
    const { actions } = renderPalette({ threads: [ACTION] });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.click(rows().getByText("Tidy the intro"));
    expect(actions.openThread).toHaveBeenCalledWith("thr_1");
  });

  it("says there are none only for an empty field over no loaded actions", async () => {
    renderPalette();
    fireEvent.click(rows().getByText("Actions"));
    expect(rows().getByText("No actions yet.")).toBeDefined();
    cleanup();
    renderPalette({ threads: [ACTION] });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.change(screen.getByPlaceholderText("Find an action…"), {
      target: { value: "nowhere" },
    });
    expect(await rows().findByText("No action matches.")).toBeDefined();
    expect(rows().queryByText("No actions yet.")).toBeNull();
  });

  it("asks the server for typed text, so an action past the loaded pages is found", async () => {
    const older: Thread = { ...ACTION, id: "thr_old", title: "Draft the budget" };
    const asked: string[] = [];
    const { actions } = renderPalette({
      fakes: {
        threads: (request) => {
          asked.push(request.query);
          return { nextCursor: null, threads: [older] };
        },
      },
      threads: [ACTION],
    });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.change(screen.getByPlaceholderText("Find an action…"), {
      target: { value: " budget " },
    });
    fireEvent.click(await rows().findByText("Draft the budget"));
    expect(asked).toEqual(["budget"]);
    expect(actions.openThread).toHaveBeenCalledWith("thr_old");
  });
});

describe("a page switch", () => {
  it("keeps the one dialog and its field, with the caret still in it", async () => {
    renderPalette();
    const dialog = screen.getByRole("dialog");
    const field = screen.getByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    fireEvent.click(rows().getByText("Search across the vault…"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(vaultSearchBox()).toBe(field);
    expect(document.activeElement).toBe(field);
  });
});

const TEMPLATE: VaultEntry = { kind: "file", path: "templates/Meeting.md" };

describe("the template pages", () => {
  it("lists templates by stem and creates a note from the picked one", () => {
    const { actions, onOpenChange } = renderPalette({ entries: [...ENTRIES, TEMPLATE] });
    fireEvent.click(rows().getByText("New note from template…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(rows().getByText("Meeting"));
    expect(actions.newNoteFromTemplate).toHaveBeenCalledWith("templates/Meeting.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers Insert template only over an open note, and inserts the picked one", () => {
    renderPalette({ entries: [...ENTRIES, TEMPLATE] });
    expect(rows().queryByText("Insert template…")).toBeNull();
    cleanup();
    const note = makeNote();
    const { actions } = renderPalette({ entries: [...ENTRIES, TEMPLATE], note });
    fireEvent.click(rows().getByText("Insert template…"));
    fireEvent.click(rows().getByText("Meeting"));
    expect(note.insertTemplate).toHaveBeenCalledWith("templates/Meeting.md");
    expect(actions.newNoteFromTemplate).not.toHaveBeenCalled();
  });

  it("says where templates come from when the folder is empty", () => {
    renderPalette();
    fireEvent.click(rows().getByText("New note from template…"));
    expect(rows().getByText(/No templates yet/u)).toBeDefined();
  });
});

describe("the new-note-in-folder page", () => {
  it("stays open, lists folders and creates in the picked one", () => {
    const { actions, onOpenChange } = renderPalette();
    fireEvent.click(rows().getByText("New note in folder…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(rows().getByText("Vault root")).toBeDefined();
    fireEvent.click(rows().getByText("notes/daily"));
    expect(actions.newNote).toHaveBeenCalledWith("notes/daily");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters folders by the query and always keeps the root", () => {
    renderPalette();
    fireEvent.click(rows().getByText("New note in folder…"));
    fireEvent.change(screen.getByPlaceholderText("New note in which folder?"), {
      target: { value: "daily" },
    });
    expect(rows().getByText("notes/daily")).toBeDefined();
    expect(rows().queryByText(/^notes$/u)).toBeNull();
    expect(rows().getByText("Vault root")).toBeDefined();
  });
});

describe("the move-to-folder page", () => {
  it("is offered for the open note and moves it into the picked folder", () => {
    const { actions, onOpenChange } = renderPalette({ note: makeNote("Welcome.md") });
    fireEvent.click(rows().getByText("Move note to folder…"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(rows().getByText("notes/daily"));
    expect(actions.moveNote).toHaveBeenCalledWith("Welcome.md", "notes/daily");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the folder the note is already in, and the root when that is it", () => {
    renderPalette({ note: makeNote("Welcome.md") });
    fireEvent.click(rows().getByText("Move note to folder…"));
    expect(rows().queryByText("Vault root")).toBeNull();
    expect(rows().getByText(/^notes$/u)).toBeDefined();
  });

  it("opens straight on the page for a requested entry, and hides its own subtree", () => {
    const { actions } = renderPalette({
      request: { nonce: 1, page: "move-to-folder", subject: "notes" },
    });
    expect(screen.getByPlaceholderText("Move to which folder?")).toBeDefined();
    expect(rows().queryByText(/^notes$/u)).toBeNull();
    expect(rows().queryByText("notes/daily")).toBeNull();
    expect(rows().queryByText("Vault root")).toBeNull();
    expect(rows().getByText("No folder it can move to.")).toBeDefined();
    expect(actions.moveNote).not.toHaveBeenCalled();
  });

  it("is absent from the root page with no note open", () => {
    renderPalette();
    expect(rows().queryByText("Move note to folder…")).toBeNull();
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

describe("the search page", () => {
  it("is reached from the root's command and from the page a shortcut names", () => {
    renderPalette();
    fireEvent.click(rows().getByText("Search across the vault…"));
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
    expect(await rows().findByText("again")).toBeDefined();
    expect(rows().getByText("Big Ideas · notes/ideas.md")).toBeDefined();
    const hits = rows().getAllByText("big");
    expect(hits).toHaveLength(2);
    const [, second] = hits;
    if (second === undefined) {
      throw new Error("the second match row is missing");
    }
    fireEvent.click(second);
    expect(actions.openMatch).toHaveBeenCalledWith(
      expect.objectContaining({ line: 9, ordinal: 1, path: "notes/ideas.md" }),
      "big",
      { caseSensitive: false, wholeWord: false },
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hands a pick the toggles its listing was read with, so the ordinal counts among them", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    fireEvent.click(screen.getByLabelText("Whole word"));
    await waitFor(() => {
      expect(replaceButton()).toHaveProperty("disabled", false);
    });
    const [first] = rows().getAllByText("big");
    if (first === undefined) {
      throw new Error("the first match row is missing");
    }
    fireEvent.click(first);
    expect(actions.openMatch).toHaveBeenCalledWith(
      expect.objectContaining({ ordinal: 0, path: "notes/ideas.md" }),
      "big",
      { caseSensitive: false, wholeWord: true },
    );
  });

  it("replaces across the listed notes with the toggles it shows", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    fireEvent.click(screen.getByLabelText("Match case"));
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "huge" } });
    // the toggle re-keys the listing, and the replace waits for the rows that answer it
    await waitFor(() => {
      expect(replaceButton()).toHaveProperty("disabled", false);
    });
    fireEvent.click(replaceButton());
    const [call] = actions.replaceAll.mock.calls;
    expect(call?.[0]).toEqual({
      needle: "big",
      options: { caseSensitive: true, wholeWord: false },
      paths: ["notes/ideas.md"],
      replacement: "huge",
    });
    expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("offers no replace while a flipped toggle's listing is in flight", async () => {
    const wholeWordListing = deferred<null>();
    const { actions } = renderPalette({
      fakes: {
        matches: async (request) => {
          if (request.wholeWord === true) {
            await wholeWordListing.promise;
          }
          return twoMatches(2)(request);
        },
      },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    expect(replaceButton()).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByLabelText("Whole word"));
    // the last listing stays up while the new one is read, but it no longer answers the toggles
    expect(rows().getByText("again")).toBeDefined();
    expect(replaceButton()).toHaveProperty("disabled", true);
    fireEvent.click(replaceButton());
    expect(actions.replaceAll).not.toHaveBeenCalled();
    wholeWordListing.resolve(null);
    await waitFor(() => {
      expect(replaceButton()).toHaveProperty("disabled", false);
    });
    fireEvent.click(replaceButton());
    expect(actions.replaceAll.mock.calls[0]?.[0].options).toEqual({
      caseSensitive: false,
      wholeWord: true,
    });
  });

  it("offers no replace while the box is ahead of its listing", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    fireEvent.change(vaultSearchBox(), { target: { value: "bigger" } });
    expect(replaceButton()).toHaveProperty("disabled", true);
    await waitFor(() => {
      expect(replaceButton()).toHaveProperty("disabled", false);
    });
    fireEvent.click(replaceButton());
    expect(actions.replaceAll.mock.calls[0]?.[0].needle).toBe("bigger");
  });

  it("cancels a running replace when the palette closes", async () => {
    const run = deferred<null>();
    const replaceAll = vi.fn<PaletteActions["replaceAll"]>(async () => {
      await run.promise;
    });
    const { onOpenChange, props, rerender } = renderPalette({
      actions: { ...makeActions(), replaceAll },
      fakes: { matches: twoMatches(2) },
      request: { nonce: 1, page: "search" },
    });
    // the workspace closes the palette when it asks to close
    onOpenChange.mockImplementation((open) => {
      rerender({ ...props, open });
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    fireEvent.click(replaceButton());
    const handed = replaceAll.mock.calls[0]?.[1];
    expect(handed?.signal?.aborted).toBe(false);
    fireEvent.keyDown(vaultSearchBox(), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(handed?.signal?.aborted).toBe(true);
    run.resolve(null);
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
    await rows().findByText("again");
    fireEvent.click(replaceButton());
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

  it("drops the last listing when the scan refuses, and says so", async () => {
    // the client logs every refused call in dev
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPalette({
      fakes: {
        matches: (request) => {
          if (request.q === "bigger") {
            throw new Error("scan down");
          }
          return twoMatches(2)(request);
        },
      },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    fireEvent.change(vaultSearchBox(), { target: { value: "bigger" } });
    // the last listing stands in while the read is in flight, so only the refusal clears it
    expect(await rows().findByText("Could not search just now.")).toBeDefined();
    expect(rows().queryByText("again")).toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it("refuses to replace while the listing is cut, and says so", async () => {
    const { actions } = renderPalette({
      fakes: { matches: twoMatches(5) },
      request: { nonce: 1, page: "search" },
    });
    fireEvent.change(vaultSearchBox(), { target: { value: "big" } });
    await rows().findByText("again");
    expect(rows().getByText(/2 of 5 matches shown/u)).toBeDefined();
    fireEvent.click(replaceButton());
    expect(actions.replaceAll).not.toHaveBeenCalled();
  });
});

const SHARED_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";

const someProblems = (): KnowledgeProblemsResponse => ({
  duplicateIds: {
    rows: [{ id: SHARED_ID, paths: ["Plan.md", "Plan copy.md"] }],
    total: 1,
  },
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
    fireEvent.click(rows().getByText("Problems"));
    expect(await rows().findByText("Unresolved links · 3")).toBeDefined();
    expect(rows().getByText("Orphans · 1")).toBeDefined();
    expect(rows().getByText("Duplicate stems · 1")).toBeDefined();
    expect(rows().getByText("Duplicate ids · 1")).toBeDefined();
    expect(rows().queryByText(/Missing embeds/u)).toBeNull();
    expect(rows().getByText(/2 more not shown/u)).toBeDefined();
    fireEvent.click(rows().getByText("[[Nowhere]] in Welcome"));
    expect(actions.openProblemLink).toHaveBeenCalledWith("Welcome.md", "Nowhere");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens an orphan or a duplicate as a note, and filters rows by the query", async () => {
    const { actions } = renderPalette({ fakes: { problems: someProblems } });
    fireEvent.click(rows().getByText("Problems"));
    await rows().findByText("Lonely");
    fireEvent.change(screen.getByPlaceholderText("Filter problems…"), {
      target: { value: "a/guide" },
    });
    expect(rows().queryByText("Lonely")).toBeNull();
    fireEvent.click(rows().getByText("a/Guide.md"));
    expect(actions.openNote).toHaveBeenCalledWith("a/Guide.md");
    expect(actions.openProblemLink).not.toHaveBeenCalled();
  });

  it("names each note sharing an id, and opens the one picked", async () => {
    const { actions } = renderPalette({ fakes: { problems: someProblems } });
    fireEvent.click(rows().getByText("Problems"));
    await rows().findByText("Duplicate ids · 1");
    expect(rows().getAllByText(SHARED_ID)).toHaveLength(2);
    fireEvent.click(rows().getByText("Plan copy.md"));
    expect(actions.openNote).toHaveBeenCalledWith("Plan copy.md");
  });

  it("says when the vault is clean", async () => {
    renderPalette();
    fireEvent.click(rows().getByText("Problems"));
    expect(await rows().findByText(/No problems:/u)).toBeDefined();
  });
});

describe("the keyboard shortcuts page", () => {
  it("lists every row of every table, spelled for the keyboard the palette was given", () => {
    renderPalette();
    fireEvent.click(rows().getByText("Keyboard shortcuts"));
    expect(screen.getByPlaceholderText("Filter shortcuts…")).toBeDefined();
    for (const row of GLOBAL_SHORTCUTS) {
      expect(rows().getByText(row.label)).toBeDefined();
      expect(chords()).toContainEqual(hotkeyCaps(globalShortcutHotkey(row), "meta"));
    }
    for (const row of [
      ...MARK_SHORTCUTS,
      ...EDITOR_SHORTCUTS,
      ...FIND_BAR_SHORTCUTS,
      ...COMMENT_SHORTCUTS,
    ]) {
      expect(rows().getByText(row.label)).toBeDefined();
      expect(chords()).toContainEqual(hotkeyCaps(row.hotkey, "meta"));
    }
  });

  it("filters by label or chord", () => {
    renderPalette();
    fireEvent.click(rows().getByText("Keyboard shortcuts"));
    fireEvent.change(screen.getByPlaceholderText("Filter shortcuts…"), {
      target: { value: "⇧⌘G" },
    });
    expect(rows().getByText("Previous match")).toBeDefined();
    expect(rows().queryByText("Next match")).toBeNull();
  });
});

describe("a command's binding", () => {
  it("is the global table's row, not a literal", () => {
    renderPalette();
    expect(chords()).toContainEqual(["⌘", "D"]);
    expect(chords()).toContainEqual(["⌘", ","]);
    cleanup();
    renderPalette({ modifier: "ctrl" });
    expect(chords()).toContainEqual(["Ctrl", "D"]);
    expect(chords()).toContainEqual(["Ctrl", ","]);
  });
});
