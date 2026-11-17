import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { getEditorHostActions } from "@repo/editor/host-io";
import { seedDoc } from "@repo/editor/live/note-blocks";
import { getLiveEditor } from "@repo/editor/live-editor";
import { noteServer } from "@repo/editor/test-support/note-server";
import { toast } from "@repo/ui/components/sonner";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { onlineManager } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { forgetAccountStorage } from "./cloud/account-storage";
import { windowLayout } from "./prefs";
import { createLibraryRouter, openedOver } from "./test-support/library-router";
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
const pageAt = (entry: string, cell: FakeCell, answer?: (call: CellCall) => object | undefined) => {
  forgetAccountStorage();
  const { calls, library } = fakePageLibrary({ answer, cell });
  const router = createLibraryRouter(entry, openedOver(library));
  render(<RouterProvider router={router} />);
  return { calls, router };
};

// a key under the platform's modifier
const chord = (key: string) =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

// the whole page with a note open
const pageOverANote = (): void => {
  const cell = createFakeCell();
  pageAt(`/library?item=${cell.seed.item({ title: NOTE })}`, cell);
};

// the whole page with a note open over its live document, once the note's line has drawn
const pageOverALiveNote = async (alsoInAddress = "") => {
  const server = noteServer();
  const cell = createFakeCell();
  const id = cell.seed.item({ title: NOTE });
  seedDoc(server.note(id).doc, [
    {
      block: { children: [{ text: "Typed on the Mac." }], id: "p1", type: "p" },
      section: "note",
    },
  ]);
  const { router } = pageAt(`/library?item=${id}${alsoInAddress}`, cell);
  // read whole, since a find in the address marks its words in the commit that draws them
  await waitFor(() => {
    expect(document.querySelector("[data-slate-editor]")?.textContent).toBe("Typed on the Mac.");
  });
  return { id, router, server };
};

type PageRouter = ReturnType<typeof pageAt>["router"];

const openItem = (router: PageRouter): string | null =>
  new URL(router.history.location.href, "http://page").searchParams.get("item");

// the whole page at the library, with Save a link's dialog open
const askedToSaveALink = async (answer?: (call: CellCall) => object | undefined) => {
  const { calls } = pageAt("/library", createFakeCell(), answer);
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

describe("Empty Deleted", () => {
  it("is one ask of the cell for all of Deleted, whatever kind the grid is narrowed to", async () => {
    const cell = createFakeCell();
    const kept = cell.seed.item({ title: "Kept" });
    cell.seed.item({ deletedAt: 1, title: "A deleted note" });
    cell.seed.item({ deletedAt: 1, kind: "pdf", title: "A deleted paper" });
    const said = vi.spyOn(toast, "success");
    const deleted = encodeURIComponent(JSON.stringify({ kind: "deleted" }));
    const { calls } = pageAt(`/library?scope=${deleted}&kind=pdf`, cell);

    // offered once the listing answered
    const empty = await screen.findByRole("button", { name: "Empty Deleted…" });
    await waitFor(() => {
      expect(empty).toHaveProperty("disabled", false);
    });
    fireEvent.click(empty);
    await screen.findByText("Delete 2 items forever?");
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Deleting 2 items.");
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
    const { calls } = pageAt("/library", cell);

    const grid = await screen.findByRole("grid", { name: "Library" });
    fireEvent.keyDown(grid, chord("a"));
    fireEvent.keyDown(grid, chord("Backspace"));
    await screen.findByText("Delete 201 items?");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Deleting 201 items.");
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
    pageOverANote();

    const title = await screen.findByRole("textbox", { name: "Title" });

    expect(title.getAttribute("spellcheck")).toBe("false");
  });

  it("keeps the keyboard as Enter names it", async () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ title: NOTE });
    pageAt(`/library?item=${id}`, cell);
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
    pageAt(`/library?item=${cell.seed.item({ title: NOTE })}`, cell, (call) => {
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

describe("an open item's body", () => {
  it("is its note's live document, dialled on the account socket's ticket, read-only offline", async () => {
    const { server } = await pageOverALiveNote();

    expect(server.sockets.map((socket) => socket.ticket)).toStrictEqual(["a-ticket"]);
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
    act(() => {
      onlineManager.setOnline(false);
    });

    await screen.findByText(NEEDS_CONNECTION);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("opens with the find bar on the words its address carries, and the address drops them", async () => {
    const { id, router } = await pageOverALiveNote("&find=Mac");

    const find = await screen.findByRole("textbox", { name: "Find" });

    expect(find).toHaveProperty("value", "Mac");
    await waitFor(() => {
      expect(router.history.location.search).toBe(`?item=${id}`);
    });
  });
});

describe("an open item holding typing no connection carried", () => {
  const LEAVE = { name: "Leave without saving?" };

  const answer = async (label: string): Promise<void> => {
    const ask = await screen.findByRole("alertdialog", LEAVE);
    fireEvent.click(within(ask).getByRole("button", { name: label }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", LEAVE)).toBeNull();
    });
  };

  it("asks before a leave: Stay keeps the item and the grid's scope, Discard edits goes", async () => {
    const { id, router, server } = await pageOverALiveNote();
    server.answer = "hang";
    await act(async () => {
      server.drop();
      const editor = getLiveEditor(id);
      editor?.tf.insertText(" And here.", { at: editor.api.end([0]) });
      await Promise.resolve();
    });
    act(() => {
      onlineManager.setOnline(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Deleted" }));
    await answer("Stay");
    expect(router.history.location.search).toBe(`?item=${id}`);

    fireEvent.click(screen.getByRole("button", { name: "Back to the library" }));
    await answer("Discard edits");
    await waitFor(() => {
      expect(openItem(router)).toBeNull();
    });
  });
});

// the whole page at the library, with New note chosen from the Add menu and its item open
const madeANote = async () => {
  const cell = createFakeCell();
  const { router } = pageAt("/library", cell);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "New note" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  const id = z.string().parse(openItem(router));
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
    pageAt(`/library?item=${cell.seed.item({ folderId, title: "An article" })}`, cell);
    await screen.findByRole("textbox", { name: "Title" });

    const id = await getEditorHostActions().items.createNote({ blocks: [], title: "Extract" });

    expect(cell.item(id)?.fields.folderId).toBe(folderId);
  });

  it("quotes a passage asked about in the agent's composer, which takes the keyboard", async () => {
    pageOverANote();
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
  within(screen.getByRole("list", { name: list })).getByRole("button", { name });

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
    const { router } = pageAt("/library", readingFolder().cell);
    await shows("All items");

    fireEvent.click(railRow("Folders", /^Reading/u));
    await shows("Reading");
    fireEvent.click(railRow("Tags", /^field/u));
    await shows("#field");

    act(() => {
      router.history.back();
    });
    await shows("Reading");
    act(() => {
      router.history.back();
    });
    await shows("All items");
    act(() => {
      router.history.forward();
    });
    await shows("Reading");
  });

  it("opens the scope its address names", async () => {
    const { cell, folderId } = readingFolder();
    const scope = JSON.stringify({ folderId, kind: "folder" });

    pageAt(`/library?scope=${encodeURIComponent(scope)}`, cell);

    await shows("Reading");
  });

  it("narrows by kind in place, so Back leaves the scope rather than the kind", async () => {
    const { router } = pageAt("/library", readingFolder().cell);
    await shows("All items");
    fireEvent.click(railRow("Folders", /^Reading/u));
    await shows("Reading");

    fireEvent.click(
      within(screen.getByLabelText("Kind")).getByRole("button", { name: /^Images/u }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ kind: "image" });
    });
    act(() => {
      router.history.back();
    });
    await shows("All items");
  });

  it("shows a tag a note names in the tag's grid, leaving the note and its kind", async () => {
    const { cell } = readingFolder();
    const { router } = pageAt(
      `/library?kind=note&item=${cell.seed.item({ title: "Plans" })}`,
      cell,
    );
    await screen.findByRole("textbox", { name: "Title" });

    act(() => {
      getEditorHostActions().agent.showTag("field");
    });

    await shows("#field");
    expect(router.state.location.search).toEqual({ scope: { kind: "tag", tag: "field" } });
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
    const { router } = pageAt("/library", cell);
    await shows("All items");
    await selectAll();

    fireEvent.click(railRow("Tags", /^field/u));
    await shows("#field");
    await screen.findByText(NOTHING_SELECTED);
    await selectAll();
    act(() => {
      router.history.back();
    });

    await shows("All items");
    await screen.findByText(NOTHING_SELECTED);
  });
});

const railState = (): string | undefined => {
  const shell = document.querySelector('[data-slot="sidebar"][data-side="left"]');
  return shell instanceof HTMLElement ? shell.dataset.state : undefined;
};

describe("the window's layout", () => {
  it("opens the rail as the window last left it, and keeps its toggle for the next", async () => {
    windowLayout.setState({ railOpen: false });
    pageAt("/library", createFakeCell());
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
    pageAt("/library", createFakeCell());
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
