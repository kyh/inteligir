// @vitest-environment jsdom

import type { LibraryScope } from "@repo/domain/library-scope";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type {
  KnowledgeItemsResponse,
  KnowledgeScopesResponse,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import type { LibraryItemActions } from "../item-menu";
import { createLibrarySelection } from "../library-selection";
import { LibraryView } from "../library-view";
import type { LibraryViewProps } from "../library-view";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (path: string, kind: ItemKind): ItemRowWire => ({
  author: null,
  bare: false,
  copy: null,
  cover: null,
  description: null,
  fetchError: null,
  fetched: null,
  file: null,
  fileBytes: null,
  folder: "",
  host: null,
  id: null,
  kind,
  modifiedMs: null,
  path,
  pending: false,
  pinned: false,
  preview: "",
  published: null,
  saved: "2026-10-01T09:00:00Z",
  site: null,
  tags: [],
  title: path,
  url: null,
});

const NO_SCOPES: KnowledgeScopesResponse = { folders: [], total: 0, unsorted: 0, untagged: 0 };

const NO_KINDS: KnowledgeItemsResponse["kindCounts"] = {
  audio: 0,
  file: 0,
  image: 0,
  link: 0,
  note: 0,
  pdf: 0,
  video: 0,
};

const listing = (
  rows: ItemRowWire[],
  counts: Partial<Record<ItemKind, number>> = {},
): KnowledgeItemsResponse => ({
  items: rows,
  kindCounts: { ...NO_KINDS, ...counts },
  total: rows.length,
});

// what each listing request asked for, by its fields
const requestSchema = z.looseObject({
  folder: z.string().optional(),
  kinds: z.array(z.string()).optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  tag: z.string().optional(),
});

interface Wire {
  items?: (request: z.infer<typeof requestSchema>) => KnowledgeItemsResponse;
  scopes?: KnowledgeScopesResponse;
  failItems?: boolean;
}

const asked: z.infer<typeof requestSchema>[] = [];
let attempts = 0;

const stubWire = ({ items = () => listing([]), scopes = NO_SCOPES, failItems = false }: Wire) => {
  asked.length = 0;
  attempts = 0;
  stubRpc({
    "knowledge/items": (input) => {
      attempts += 1;
      if (failItems) {
        throw new Error("refused");
      }
      const request = requestSchema.parse(input);
      asked.push(request);
      return items(request);
    },
    "knowledge/scopes": () => scopes,
    "system/status": () => ({
      agent: { state: "off" },
      dataDir: "/data",
      mediaToken: "media-token",
      schemaVersion: 1,
      uptimeMs: 1,
      vaultDir: "/vault",
      version: "0.0.0",
    }),
    "vault/deleted": () => ({ entries: [] }),
  });
};

const itemActions = (): LibraryItemActions => ({
  askAgent: vi.fn<LibraryItemActions["askAgent"]>(),
  keepCopy: vi.fn<LibraryItemActions["keepCopy"]>(),
  move: vi.fn<LibraryItemActions["move"]>(),
  open: vi.fn<LibraryItemActions["open"]>(),
  quickLook: vi.fn<LibraryItemActions["quickLook"]>(),
  refresh: vi.fn<LibraryItemActions["refresh"]>(),
  remove: vi.fn<LibraryItemActions["remove"]>(),
  rename: vi.fn<LibraryItemActions["rename"]>(),
  reveal: null,
  setPinned: vi.fn<LibraryItemActions["setPinned"]>(),
  tag: vi.fn<LibraryItemActions["tag"]>(),
});

const mount = (scope: LibraryScope, overrides: Partial<LibraryViewProps> = {}) => {
  const selection = createLibrarySelection();
  const add = {
    addFiles: vi.fn<() => void>(),
    newFolder: vi.fn<() => void>(),
    newNote: vi.fn<(folder: string, tags?: readonly string[]) => void>(),
    saveLink: vi.fn<() => void>(),
  };
  const props: LibraryViewProps = {
    actions: itemActions(),
    add,
    insetTitleBar: false,
    kind: null,
    lead: {
      canBack: false,
      canForward: false,
      onBack: vi.fn<() => void>(),
      onForward: vi.fn<() => void>(),
      onToggleRail: vi.fn<() => void>(),
      railOpen: true,
    },
    onClearQuery: vi.fn<() => void>(),
    onKindChange: vi.fn<(kind: ItemKind | null) => void>(),
    onRenameTag: vi.fn<(tag: string) => void>(),
    onRestored: vi.fn<(path: string) => void>(),
    onSortChange: vi.fn<LibraryViewProps["onSortChange"]>(),
    q: null,
    scope,
    scrollMemory: createStore<number>()(() => 0),
    selection,
    sort: "saved",
    ...overrides,
  };
  const queryClient = createWorkspaceQueryClient();
  // a refused read is the failed state at once, not after the default's three backed-off tries
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <LibraryView {...props} />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return { add, props, selection };
};

describe("a scope with nothing in it says why", () => {
  it("offers every way in when the whole library is empty", async () => {
    stubWire({});
    const { add } = mount({ kind: "all" });
    expect(await screen.findByText("Your library is empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save a link…" }));
    fireEvent.click(screen.getByRole("button", { name: "Add files…" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(add.saveLink).toHaveBeenCalledOnce();
    expect(add.addFiles).toHaveBeenCalledOnce();
    expect(add.newNote).toHaveBeenCalledWith("");
    expect(screen.queryByRole("button", { name: "Import from Raindrop…" })).toBeNull();
  });

  it("offers Import only where its page exists", async () => {
    stubWire({});
    const importRaindrop = vi.fn<() => void>();
    mount(
      { kind: "all" },
      {
        add: {
          addFiles: vi.fn<() => void>(),
          importRaindrop,
          newFolder: vi.fn<() => void>(),
          newNote: vi.fn<(folder: string, tags?: readonly string[]) => void>(),
          saveLink: vi.fn<() => void>(),
        },
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Import from Raindrop…" }));
    expect(importRaindrop).toHaveBeenCalledOnce();
  });

  it("reads Unsorted as its folder and says there is nothing to sort", async () => {
    stubWire({});
    mount({ kind: "unsorted" });
    expect(await screen.findByText("Nothing to sort.")).toBeTruthy();
    expect(asked[0]).toMatchObject({ folder: "Unsorted", sort: "saved" });
  });

  it("offers a new note in an empty folder, written there", async () => {
    stubWire({});
    const { add } = mount({ kind: "folder", path: "Reading/Essays" });
    fireEvent.click(await screen.findByRole("button", { name: "New note here" }));
    expect(add.newNote).toHaveBeenCalledWith("Reading/Essays");
    expect(screen.getByRole("heading", { name: "Essays" })).toBeTruthy();
  });

  it("names the tag nothing carries", async () => {
    stubWire({});
    mount({ kind: "tag", tag: "work" });
    expect(await screen.findByText("No items tagged #work.")).toBeTruthy();
    expect(asked[0]).toMatchObject({ tag: "work" });
  });

  it("names the search that matched nothing, ranked by the server rather than sorted", async () => {
    stubWire({});
    const onClearQuery = vi.fn<() => void>();
    mount({ kind: "all" }, { onClearQuery, q: "tides" });
    expect(await screen.findByText("Nothing matches “tides”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearQuery).toHaveBeenCalledOnce();
    expect(asked[0]).toMatchObject({ q: "tides" });
    expect(asked[0]?.sort).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Date saved" })).toBeNull();
  });

  it("names the kind a chip holds nothing of, and lets it go", async () => {
    stubWire({ items: () => listing([], { link: 3 }) });
    const onKindChange = vi.fn<(kind: ItemKind | null) => void>();
    mount({ kind: "all" }, { kind: "pdf", onKindChange });
    expect(await screen.findByText("No PDFs here")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(onKindChange).toHaveBeenCalledWith(null);
    expect(asked[0]).toMatchObject({ kinds: ["pdf"] });
  });

  it("says the library could not be read, and reads it again on Retry", async () => {
    // the client logs each refusal it is handed
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubWire({ failItems: true });
    mount({ kind: "all" });
    expect(await screen.findByText("The library could not be read")).toBeTruthy();
    const before = attempts;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(attempts).toBeGreaterThan(before);
    });
  });

  it("shows Deleted from its own listing, with no sort and no count", async () => {
    stubWire({});
    mount({ kind: "deleted" });
    expect(await screen.findByText("Nothing deleted.")).toBeTruthy();
    expect(asked).toEqual([]);
    expect(screen.queryByRole("button", { name: "Date saved" })).toBeNull();
  });
});

describe("+ Add › New note", () => {
  it.each([
    [{ kind: "folder", path: "Reading" }, "Reading", []],
    [{ kind: "unsorted" }, "Unsorted", []],
    [{ kind: "tag", tag: "recipes" }, "Unsorted", ["recipes"]],
    [{ kind: "all" }, "", []],
  ] satisfies [LibraryScope, string, string[]][])(
    "writes the note where %o lists it",
    async (scope, folder, tags) => {
      stubWire({ items: () => listing([row("a.md", "note")], { note: 1 }) });
      const { add } = mount(scope);
      fireEvent.click(await screen.findByRole("button", { name: "Add" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "New note" }));
      expect(add.newNote).toHaveBeenCalledWith(folder, tags);
    },
  );
});

describe("the chips and the count", () => {
  it("counts the scope in the header and offers a chip per kind it holds", async () => {
    const rows = [row("a.md", "link"), row("b.md", "link"), row("c.md", "pdf")];
    stubWire({ items: () => listing(rows, { link: 2, pdf: 1 }) });
    mount({ kind: "all" });
    const chips = await screen.findByRole("group", { name: "Kind" });
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Links2", "PDFs1"]);
    expect(screen.getByRole("heading", { name: "All items" }).nextSibling?.textContent).toBe("3");
  });

  it("offers no chip row when the scope holds one kind", async () => {
    stubWire({ items: () => listing([row("a.md", "link")], { link: 1 }) });
    mount({ kind: "all" });
    await waitFor(() => {
      expect(asked.length).toBeGreaterThan(0);
    });
    await screen.findByText("1");
    expect(screen.queryByRole("group", { name: "Kind" })).toBeNull();
  });

  it("presses one chip at a time", async () => {
    const rows = [row("a.md", "link"), row("b.md", "pdf")];
    stubWire({ items: () => listing(rows, { link: 1, pdf: 1 }) });
    const onKindChange = vi.fn<(kind: ItemKind | null) => void>();
    mount({ kind: "all" }, { onKindChange });
    fireEvent.click(await screen.findByRole("button", { name: /^PDFs/u }));
    expect(onKindChange).toHaveBeenCalledWith("pdf");
  });

  it("shows the palette's search as a chip that clears it", async () => {
    stubWire({ items: () => listing([row("a.md", "link")], { link: 1 }) });
    const onClearQuery = vi.fn<() => void>();
    mount({ kind: "all" }, { onClearQuery, q: "tides" });
    fireEvent.click(await screen.findByRole("button", { name: "Clear the search for “tides”" }));
    expect(onClearQuery).toHaveBeenCalledOnce();
  });
});

describe("the selection's strip", () => {
  it("stands in the chips' place while anything is selected, and runs a verb on it", async () => {
    const rows = [row("a.md", "link"), row("b.md", "pdf")];
    stubWire({ items: () => listing(rows, { link: 1, pdf: 1 }) });
    const { props, selection } = mount({ kind: "all" });
    await screen.findByRole("group", { name: "Kind" });
    act(() => {
      selection.apply({ kind: "click", path: "a.md" });
      selection.apply({ kind: "toggle", path: "b.md" });
    });
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Kind" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tag…" }));
    await waitFor(() => {
      expect(props.actions.tag).toHaveBeenCalledWith(["a.md", "b.md"]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear the selection" }));
    expect(selection.store.getState().selected.size).toBe(0);
  });

  it("counts ⌘A by the scope's total", async () => {
    const rows = [row("a.md", "link"), row("b.md", "pdf"), row("c.md", "pdf")];
    stubWire({ items: () => listing(rows, { link: 1, pdf: 2 }) });
    const { selection } = mount({ kind: "all" });
    await screen.findByRole("group", { name: "Kind" });
    act(() => {
      selection.apply({ kind: "all" });
    });
    expect(screen.getByText("3 selected")).toBeTruthy();
  });
});
