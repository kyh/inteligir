// @vitest-environment jsdom

import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { getEditorHostActions } from "@repo/editor/host-io";
import { toast } from "@repo/ui/components/sonner";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppRouter } from "../router";
import { createPageQueryClient } from "./cloud/v1";
import { forgetPref, PREFS } from "./prefs";
import { fakePageLibrary } from "./test-support/fake-page-library";
import type { CellCall } from "./test-support/fake-page-library";
import { memoryCell } from "./test-support/memory-cell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADDRESS = "The page's address";
const NOTE = "Field notes";

// the whole page at an address, over a cell in memory
const pageAt = (
  entry: string,
  cell: ReturnType<typeof memoryCell>,
  answer: (call: CellCall) => object = cell.answer,
) => {
  forgetPref(PREFS.libraryScope);
  const { calls, library } = fakePageLibrary({ answer });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }), {
    library,
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  return { calls, router };
};

const callsTo = (calls: readonly CellCall[], path: string): unknown[] =>
  calls.filter((call) => call.path === path).map((call) => call.input);

// the whole page with a note open
const pageOverANote = (): void => {
  const cell = memoryCell();
  pageAt(`/library?item=${cell.note(NOTE)}`, cell);
};

// the whole page at the library, with Save a link's dialog open
const askedToSaveALink = async (answer?: (call: CellCall) => object) => {
  const cell = memoryCell();
  const { calls } = pageAt("/library", cell, answer);
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
    const cell = memoryCell();
    await askedToSaveALink((call) => {
      if (call.path === "library.items.saveLink") {
        throw new Error("the cell is down");
      }
      return cell.answer(call);
    });
    const failed = vi.spyOn(toast, "error");

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledWith("That link couldn't be saved.");
    });
  });
});

describe("Empty Deleted", () => {
  it("goes in the chunks the route takes, under one toast with Stop", async () => {
    const cell = memoryCell();
    for (let at = 0; at <= BULK_ITEMS_MAX; at += 1) {
      cell.note(`Deleted ${String(at)}`, { deletedAt: 1 });
    }
    const purge = z.object({ ids: z.array(z.string()) });
    const running = vi.spyOn(toast, "loading");
    const said = vi.spyOn(toast, "success");
    const { calls } = pageAt("/library", cell);

    fireEvent.click(await screen.findByRole("button", { name: "Deleted" }));
    fireEvent.click(await screen.findByRole("button", { name: "Empty Deleted…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete forever" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe(`Deleted ${String(BULK_ITEMS_MAX + 1)} items forever.`);
    });
    const chunks = callsTo(calls, "library.items.purge").map(
      (input) => purge.parse(input).ids.length,
    );
    expect(chunks).toStrictEqual([BULK_ITEMS_MAX, 1]);
    expect(running.mock.calls[0]?.[1]?.action).toMatchObject({ label: "Stop" });
  });
});

describe("an open item's title", () => {
  it("sets its own spell check off, as the body does", async () => {
    pageOverANote();

    const title = await screen.findByRole("textbox", { name: "Title" });

    expect(title.getAttribute("spellcheck")).toBe("false");
  });
});

// the whole page at the library, with New note chosen from the Add menu and its item open
const madeANote = async () => {
  const cell = memoryCell();
  const { router } = pageAt("/library", cell);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "New note" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  const id = z
    .string()
    .parse(new URL(router.history.location.href, "http://page").searchParams.get("item"));
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
    const cell = memoryCell();
    const folderId = "0199a4c2-0000-7000-8000-0000000000f1";
    cell.folder({ id: folderId, name: "Reading", parentId: null, sort: "a0" });
    pageAt(`/library?item=${cell.note("An article", { folderId })}`, cell);
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
