import { deferred } from "@repo/contract/deferred";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { getEditorHostActions } from "@repo/editor/host-io";
import { getLiveEditor } from "@repo/editor/live-editor";
import { toast } from "@repo/ui/components/sonner";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { forgetAccountStorage } from "./cloud/account-storage";
import { newId } from "./library/new-id";
import { windowLayout } from "./prefs";
import { layOutCardGrids } from "./test-support/card-grid-layout";
import { addressed, openedOver, renderLibraryAt } from "./test-support/library-page";
import { fakePageLibrary } from "./test-support/fake-page-library";
import type { CellCall } from "./test-support/fake-page-library";

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ADDRESS = "The page's address";
const NOTE = "Field notes";

// the whole page at an address, over the fake cell, unless the suite answers a call itself
const pageAt = async (
  entry: string,
  cell: FakeCell,
  answer?: (call: CellCall) => object | undefined | Promise<object | undefined>,
) => {
  forgetAccountStorage();
  const { calls, library } = fakePageLibrary({ answer, cell });
  renderLibraryAt(entry, await openedOver(library));
  return { calls };
};

// a key under the platform's modifier
const chord = (key: string) =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

// the whole page with a note open
const pageOverANote = async (): Promise<void> => {
  const cell = createFakeCell();
  await pageAt(`/library?item=${cell.seed.item({ title: NOTE })}`, cell);
};

// the whole page with a note open over its saved body, once the note's line has drawn
const pageOverASavedNote = async (
  alsoInAddress = "",
  answer?: (call: CellCall) => object | undefined,
) => {
  const cell = createFakeCell();
  const id = cell.seed.item({ title: NOTE }, [
    {
      block: { children: [{ text: "Typed on the Mac." }], id: "p1", type: "p" },
      section: "note",
    },
  ]);
  await pageAt(`/library?item=${id}${alsoInAddress}`, cell, answer);
  // read whole, since a find in the address marks its words in the commit that draws them
  await waitFor(() => {
    expect(document.querySelector("[data-slate-editor]")?.textContent).toBe("Typed on the Mac.");
  });
  return { cell, id };
};

// what is typed at the end of the open note's first block
const typeInto = async (id: string, text: string): Promise<void> => {
  await act(async () => {
    const editor = getLiveEditor(id);
    editor?.tf.insertText(text, { at: editor.api.end([0]) });
    await Promise.resolve();
  });
};

// the whole page at the library, with Save a link's dialog open
const askedToSaveALink = async (answer?: (call: CellCall) => object | undefined) => {
  const { calls } = await pageAt("/library", createFakeCell(), answer);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Save a link…" }));
  await screen.findByRole("textbox", { name: ADDRESS });
  return calls;
};

const submit = (address: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name: ADDRESS }), {
    target: { value: address },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
};

describe("Save a link", () => {
  it("keeps what was typed and says why when it is no web address", async () => {
    const calls = await askedToSaveALink();

    submit("example.com");

    expect(screen.getByRole("textbox", { name: ADDRESS })).toHaveProperty("value", "example.com");
    expect(screen.getByRole("alert").textContent).toContain("https://");
    expect(callsTo(calls, "library.items.saveLink")).toStrictEqual([]);
  });

  it("saves a web address and closes", async () => {
    const calls = await askedToSaveALink();
    const said = vi.spyOn(toast, "success");

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Saved.");
    });
    expect(screen.queryByRole("textbox", { name: ADDRESS })).toBeNull();
    expect(callsTo(calls, "library.items.saveLink")).toMatchObject([
      { url: "https://example.com/page" },
    ]);
  });

  it("says so when the save itself fails", async () => {
    await askedToSaveALink((call) => {
      if (call.path === "library.items.saveLink") {
        throw new Error("the cell is down");
      }
    });
    const failed = vi.spyOn(toast, "error");

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(failed.mock.lastCall?.[0]).toBe(
        "That link couldn't be saved. The library didn't answer.",
      );
    });
  });
});

describe("a card in the grid", () => {
  it("pins from its menu, the pin drawn on the card before the cell lands it", async () => {
    layOutCardGrids({ height: 800, width: 1200 });
    const cell = createFakeCell();
    const id = cell.seed.item({ title: NOTE });
    const landing = deferred();
    await pageAt("/library", cell, async (call) => {
      if (call.path === "library.items.organize") {
        await landing.promise;
      }
    });

    const card = await screen.findByRole("gridcell", { name: NOTE });
    expect(within(card).queryByLabelText("Pinned")).toBeNull();
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));

    await within(card).findByLabelText("Pinned");
    expect(card.getAttribute("aria-selected")).toBe("true");
    expect(cell.item(id)?.fields.pinnedAt).toBeNull();
    landing.resolve();
    await vi.waitFor(() => {
      expect(cell.item(id)?.fields.pinnedAt).not.toBeNull();
    });
  });

  it("opens its menu on the menu key with its first row lit, and on a right-click with none", async () => {
    layOutCardGrids({ height: 800, width: 1200 });
    const cell = createFakeCell();
    cell.seed.item({ title: NOTE });
    await pageAt("/library", cell);

    const card = await screen.findByRole("gridcell", { name: NOTE });
    card.focus();
    fireEvent.keyDown(card, { key: "ContextMenu" });
    const open = await screen.findByRole("menuitem", { name: "Open" });
    await waitFor(() => {
      expect(Object.hasOwn(open.dataset, "highlighted")).toBe(true);
    });
    expect(document.activeElement).toBe(open);

    fireEvent.keyDown(open, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    fireEvent.contextMenu(card);
    const menu = await screen.findByRole("menu");
    await waitFor(() => {
      expect(menu.contains(document.activeElement)).toBe(true);
    });
    expect(menu.querySelector("[data-highlighted]")).toBeNull();
  });
});

describe("Empty Deleted", () => {
  it("is one ask of the cell for all of Deleted, whatever kind the grid is narrowed to, one it lists none of too", async () => {
    const cell = createFakeCell();
    const kept = cell.seed.item({ title: "Kept" });
    cell.seed.item({ deletedAt: 1, title: "A deleted note" });
    cell.seed.item({ deletedAt: 1, kind: "pdf", title: "A deleted paper" });
    const said = vi.spyOn(toast, "success");
    const { calls } = await pageAt("/library?scope=deleted&kind=video", cell);

    // offered once the listing answered
    const empty = await screen.findByRole("button", { name: "Empty Deleted…" });
    await waitFor(() => {
      expect(empty).toHaveProperty("disabled", false);
    });
    fireEvent.click(empty);
    await screen.findByText("Delete 2 items forever?");
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Deleted 2 items forever.");
    });
    expect(callsTo(calls, "library.items.sweep")).toStrictEqual([
      { except: [], scope: { kind: "deleted" }, verb: { kind: "purge" } },
    ]);
    expect([...cell.items().keys()]).toStrictEqual([kept]);
  });
});

describe("⌘A", () => {
  it("selects the scope past the cards read, and its verb asks the cell for all of it", async () => {
    // one more than the grid's first page reads
    const listed = 201;
    const cell = createFakeCell();
    for (let at = 0; at < listed; at += 1) {
      cell.seed.item({ title: `Note ${String(at)}` });
    }
    const said = vi.spyOn(toast, "success");
    const { calls } = await pageAt("/library", cell);

    const grid = await screen.findByRole("grid", { name: "Library" });
    fireEvent.keyDown(grid, chord("a"));
    fireEvent.keyDown(grid, chord("Backspace"));
    await screen.findByText("Delete 201 items?");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Moved 201 items to Deleted.");
    });
    expect(callsTo(calls, "library.items.sweep")).toStrictEqual([
      { except: [], scope: { kind: "all" }, verb: { kind: "delete" } },
    ]);
    expect(callsTo(calls, "library.items.delete")).toStrictEqual([]);
    expect([...cell.items().values()].every((item) => item.fields.deletedAt !== null)).toBe(true);
  });
});

describe("an open item's title", () => {
  it("sets its own spell check off, as the body does", async () => {
    await pageOverANote();

    const title = await screen.findByRole("textbox", { name: "Title" });

    expect(title.getAttribute("spellcheck")).toBe("false");
  });

  it("keeps the keyboard as Enter names it", async () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ title: NOTE });
    await pageAt(`/library?item=${id}`, cell);
    const title = await screen.findByRole("textbox", { name: "Title" });

    title.focus();
    fireEvent.change(title, { target: { value: "Field journal" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await vi.waitFor(() => {
      expect(cell.item(id)?.fields.title).toBe("Field journal");
    });
    expect(document.activeElement).toBe(title);
    expect(title).toHaveProperty("value", "Field journal");
  });

  it("says why the cell refused a new one, and shows the one it holds", async () => {
    const cell = createFakeCell();
    await pageAt(`/library?item=${cell.seed.item({ title: NOTE })}`, cell, (call) => {
      if (call.path === "library.items.organize") {
        throw new Error("the cell is down");
      }
    });
    const failed = vi.spyOn(toast, "error");
    const title = await screen.findByRole("textbox", { name: "Title" });

    fireEvent.change(title, { target: { value: "Field journal" } });
    fireEvent.blur(title);

    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledWith("The title couldn't be changed.");
    });
    await vi.waitFor(() => {
      expect(title).toHaveProperty("value", NOTE);
    });
  });
});

describe("an open link nobody named", () => {
  it("leaves its title empty, the address it goes by as the placeholder", async () => {
    const cell = createFakeCell();
    const id = cell.seed.item({
      kind: "link",
      title: "",
      url: "https://example.com/posts/a-long-read",
    });
    await pageAt(`/library?item=${id}`, cell);

    const title = await screen.findByRole("textbox", { name: "Title" });

    expect(title).toHaveProperty("value", "");
    expect(title).toHaveProperty("placeholder", "example.com - a long read");
  });
});

describe("an open item's body", () => {
  it("is its note's saved body, saved a moment after typing stops, and read-only offline", async () => {
    const { cell, id } = await pageOverASavedNote();

    await typeInto(id, " And here.");
    await waitFor(
      () => {
        expect(cell.held(id).blocks.map(({ block }) => block.children)).toStrictEqual([
          [{ text: "Typed on the Mac. And here." }],
        ]);
      },
      { timeout: 4000 },
    );
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
    act(() => {
      onlineManager.setOnline(false);
    });

    await screen.findByText(NEEDS_CONNECTION);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("opens with the find bar on the words its address carries, and the address drops them", async () => {
    const { id } = await pageOverASavedNote("&find=Mac");

    const find = await screen.findByRole("textbox", { name: "Find" });

    expect(find).toHaveProperty("value", "Mac");
    await waitFor(() => {
      expect(window.location.search).toBe(`?item=${id}`);
    });
  });
});

// every save of a note dropped on its way, the cell answering every other call
const dropsSaves = (call: CellCall): undefined => {
  if (call.path === "library.items.saveBody") {
    throw new Error("the network dropped the save");
  }
};

describe("an open item holding typing it couldn't save", () => {
  const LEAVE = { name: "Leave without saving?" };

  const answer = async (label: string): Promise<void> => {
    const ask = await screen.findByRole("alertdialog", LEAVE);
    fireEvent.click(within(ask).getByRole("button", { name: label }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", LEAVE)).toBeNull();
    });
  };

  it("asks before a leave: Stay keeps the item and the grid's scope, Leave anyway goes", async () => {
    const { id } = await pageOverASavedNote("", dropsSaves);
    await typeInto(id, " And here.");

    fireEvent.click(screen.getByRole("link", { name: "Deleted" }));
    await answer("Stay");
    expect(window.location.search).toBe(`?item=${id}`);

    fireEvent.click(screen.getByRole("button", { name: "Back to the library" }));
    await answer("Leave anyway");
    await waitFor(() => {
      expect(addressed("item")).toBeNull();
    });
  });
});

// the whole page at the library, with New note chosen from the Add menu and its item open
const madeANote = async () => {
  const cell = createFakeCell();
  await pageAt("/library", cell);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "New note" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  const id = z.string().parse(addressed("item"));
  return { cell, id, title };
};

describe("a new note", () => {
  it("has no title of its own, and its field says so by its placeholder", async () => {
    const { cell, id, title } = await madeANote();

    expect(cell.item(id)?.fields.title).toBe("");
    expect(title).toHaveProperty("value", "");
    expect(title).toHaveProperty("placeholder", "Untitled");
  });

  it("takes the title the person names it", async () => {
    const { cell, id, title } = await madeANote();

    fireEvent.change(title, { target: { value: "Shopping" } });
    fireEvent.blur(title);

    await vi.waitFor(() => {
      expect(cell.item(id)?.fields.title).toBe("Shopping");
    });
  });
});

describe("what the editor asks of the page", () => {
  it("makes a note in the open item's folder", async () => {
    const cell = createFakeCell();
    const folderId = cell.seed.folder("Reading");
    await pageAt(`/library?item=${cell.seed.item({ folderId, title: "An article" })}`, cell);
    await screen.findByRole("textbox", { name: "Title" });

    const id = await getEditorHostActions().items.createNote({ blocks: [], title: "Extract" });

    expect(cell.item(id)?.fields.folderId).toBe(folderId);
  });

  it("quotes a passage asked about in the agent's composer, which takes the keyboard", async () => {
    await pageOverANote();
    await screen.findByRole("textbox", { name: "Title" });

    act(() => {
      getEditorHostActions().agent.askAboutSelection("the passage");
    });

    const field = await screen.findByRole("textbox", { name: "Message the agent" });
    await vi.waitFor(() => {
      expect(field).toHaveProperty("value", "> the passage\n\n");
    });
    expect(document.activeElement).toBe(field);
  });
});

const shows = async (title: string) =>
  await screen.findByRole("heading", { level: 1, name: title });

const railRow = (list: string, name: RegExp): HTMLElement =>
  within(screen.getByRole("list", { name: list })).getByRole("link", { name });

// a folder of a tagged note and an image, so the folder offers a kind to narrow by
const readingFolder = () => {
  const cell = createFakeCell();
  const folderId = cell.seed.folder("Reading");
  cell.seed.item({ folderId, tags: ["field"], title: NOTE });
  cell.seed.item({ folderId, kind: "image", title: "Pier" });
  return { cell, folderId };
};

describe("where the tab is", () => {
  it("walks scopes on Back and Forward, All items being the bare address", async () => {
    await pageAt("/library", readingFolder().cell);
    await shows("All items");

    fireEvent.click(railRow("Folders", /^Reading/u));
    await shows("Reading");
    fireEvent.click(railRow("Tags", /^field/u));
    await shows("#field");

    act(() => {
      window.history.back();
    });
    await shows("Reading");
    act(() => {
      window.history.back();
    });
    await shows("All items");
    act(() => {
      window.history.forward();
    });
    await shows("Reading");
  });

  it("opens the scope its address names", async () => {
    const { cell, folderId } = readingFolder();
    await pageAt(`/library?folder=${folderId}`, cell);

    await shows("Reading");
  });

  it("narrows by kind in place, so Back leaves the scope rather than the kind", async () => {
    await pageAt("/library", readingFolder().cell);
    await shows("All items");
    fireEvent.click(railRow("Folders", /^Reading/u));
    await shows("Reading");

    fireEvent.click(
      within(screen.getByLabelText("Kind")).getByRole("button", { name: /^Images/u }),
    );

    await waitFor(() => {
      expect(addressed("kind")).toBe("image");
    });
    act(() => {
      window.history.back();
    });
    await shows("All items");
  });

  it("shows a tag a note names in the tag's grid, leaving the note and its kind", async () => {
    const { cell } = readingFolder();
    await pageAt(`/library?kind=note&item=${cell.seed.item({ title: "Plans" })}`, cell);
    await screen.findByRole("textbox", { name: "Title" });

    act(() => {
      getEditorHostActions().agent.showTag("field");
    });

    await shows("#field");
    expect(window.location.search).toBe("?tag=field");
  });

  it("opens every scope with nothing selected, Back's too, though both scopes list the item", async () => {
    const NOTHING_SELECTED = "Select an item to see it here.";
    const selectAll = async (): Promise<void> => {
      fireEvent.keyDown(await screen.findByRole("grid", { name: "Library" }), chord("a"));
      await waitFor(() => {
        expect(screen.queryByText(NOTHING_SELECTED)).toBeNull();
      });
    };
    const cell = createFakeCell();
    cell.seed.item({ tags: ["field"], title: NOTE });
    await pageAt("/library", cell);
    await shows("All items");
    await selectAll();

    fireEvent.click(railRow("Tags", /^field/u));
    await shows("#field");
    await screen.findByText(NOTHING_SELECTED);
    await selectAll();
    act(() => {
      window.history.back();
    });

    await shows("All items");
    await screen.findByText(NOTHING_SELECTED);
  });
});

// the whole page over a cell whose listing pages answer only once `land` is called, from the
// moment `hold` is: the listing of a scope or kind the tab moves to
const pageHoldingListings = async (entry: string, cell: FakeCell) => {
  const held = deferred();
  const holding = { now: false };
  const { calls } = await pageAt(entry, cell, async (call) => {
    if (call.path === "library.listing.page" && holding.now) {
      await held.promise;
    }
    return call.path === "library.agent.send"
      ? { status: "running", threadId: newId() }
      : undefined;
  });
  return {
    calls,
    hold: () => {
      holding.now = true;
    },
    land: held.resolve,
  };
};

const kindChips = (): HTMLElement | null => screen.queryByLabelText("Kind");
// the count the header gives beside the scope's title
const headerCount = (count: string): HTMLElement | null => {
  const bar = screen.getByRole("heading", { level: 1 }).parentElement;
  return bar === null ? null : within(bar).queryByText(count);
};

describe("a scope or kind whose listing is on its way", () => {
  it("shows the grid the tab left, but not its kinds or its count", async () => {
    layOutCardGrids({ height: 800, width: 1200 });
    const { cell } = readingFolder();
    cell.seed.item({ kind: "pdf", title: "Paper" });
    const page = await pageHoldingListings("/library", cell);
    await shows("All items");
    await within(await screen.findByLabelText("Kind")).findByRole("button", { name: /^PDFs/u });
    expect(headerCount("3")).not.toBeNull();

    page.hold();
    fireEvent.click(railRow("Folders", /^Reading/u));
    await shows("Reading");
    expect(screen.getByRole("gridcell", { name: "Paper" })).toBeDefined();
    expect(kindChips()).toBeNull();
    expect(headerCount("3")).toBeNull();

    page.land();
    await waitFor(() => {
      expect(screen.queryByRole("gridcell", { name: "Paper" })).toBeNull();
    });
    expect(
      within(kindChips() ?? document.body).queryByRole("button", { name: /^PDFs/u }),
    ).toBeNull();
    expect(headerCount("2")).not.toBeNull();
  });

  it("keeps the scope's kinds while another kind of it is on its way", async () => {
    layOutCardGrids({ height: 800, width: 1200 });
    const { cell, folderId } = readingFolder();
    const page = await pageHoldingListings(`/library?folder=${folderId}`, cell);
    await shows("Reading");
    const chips = await screen.findByLabelText("Kind");

    page.hold();
    fireEvent.click(within(chips).getByRole("button", { name: /^Images/u }));
    await waitFor(() => {
      expect(addressed("kind")).toBe("image");
    });
    expect(within(chips).getByRole("button", { name: /^Notes/u })).toBeDefined();
    page.land();
  });

  it("says nothing of an empty scope the tab left", async () => {
    const cell = createFakeCell();
    cell.seed.item({ title: NOTE });
    const page = await pageHoldingListings("/library?scope=deleted", cell);
    await screen.findByText("Nothing deleted");

    page.hold();
    fireEvent.click(railRow("Library", /^All items/u));
    await shows("All items");
    expect(screen.queryByText("Nothing deleted")).toBeNull();
    expect(screen.queryByText("Your library is empty")).toBeNull();
    page.land();
    await screen.findByRole("grid", { name: "Library" });
  });

  it("tells the agent of no selection counted over the kind the tab left", async () => {
    layOutCardGrids({ height: 800, width: 1200 });
    const { cell, folderId } = readingFolder();
    const page = await pageHoldingListings(`/library?folder=${folderId}`, cell);
    fireEvent.keyDown(await screen.findByRole("grid", { name: "Library" }), chord("a"));

    page.hold();
    fireEvent.click(
      within(await screen.findByLabelText("Kind")).getByRole("button", { name: /^Images/u }),
    );
    await waitFor(() => {
      expect(addressed("kind")).toBe("image");
    });
    fireEvent.keyDown(window, chord("k"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Message the agent" }), {
      target: { value: "What are these?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await vi.waitFor(() => {
      expect(callsTo(page.calls, "library.agent.send")).toStrictEqual([
        {
          text: "What are these?",
          viewContext: {
            itemIds: [],
            kinds: ["image"],
            scope: { folderId, kind: "folder" },
            selected: 0,
            surface: "library",
          },
        },
      ]);
    });
    page.land();
  });
});

const railState = (): string | undefined => {
  const shell = document.querySelector('[data-slot="sidebar"][data-side="left"]');
  return shell instanceof HTMLElement ? shell.dataset.state : undefined;
};

describe("the window's layout", () => {
  it("opens the rail as the window last left it, and keeps its toggle for the next", async () => {
    windowLayout.setState({ railOpen: false });
    await pageAt("/library", createFakeCell());
    await screen.findByRole("button", { name: "Add to the library" });
    expect(railState()).toBe("collapsed");

    fireEvent.keyDown(window, { key: "[" });

    expect(railState()).toBe("expanded");
    expect(windowLayout.getState().railOpen).toBe(true);
  });

  it("opens the panel below the breakpoint, where it is a sheet the window's layout does not hold", async () => {
    const wide = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      Object.assign(wide(query), { matches: true }),
    );
    const PANEL = { name: "Panel" };
    windowLayout.setState({ panelOpen: false });
    await pageAt("/library", createFakeCell());
    await screen.findByRole("button", { name: "Add to the library" });

    fireEvent.keyDown(
      window,
      platformShortcutModifier() === "meta"
        ? { key: "k", metaKey: true }
        : { ctrlKey: true, key: "k" },
    );

    const sheet = await screen.findByRole("dialog", PANEL);
    expect(within(sheet).getByRole("textbox", { name: "Message the agent" })).toBeDefined();
    expect(windowLayout.getState().panelOpen).toBe(false);
    fireEvent.keyDown(window, { key: "]" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", PANEL)).toBeNull();
    });
  });
});
