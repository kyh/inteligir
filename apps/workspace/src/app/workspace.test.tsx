// @vitest-environment jsdom

import { BULK_ITEMS_MAX } from "@repo/contract/cloud/library/library-wire";
import { getEditorHostActions } from "@repo/editor/host-io";
import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice } from "@repo/library-replica/test-support/replica-harness";
import { toast } from "@repo/ui/components/sonner";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAppRouter } from "../router";
import { createPageQueryClient } from "./cloud/v1";
import { forgetPref, PREFS } from "./prefs";
import { fakePageLibrary } from "./test-support/fake-page-library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADDRESS = "The page's address";
const NOTE = "Field notes";
const HIGHLIGHT = "h1";

// the whole page with a note open, over a replica holding it with one highlight on it
const pageOverANote = async () => {
  const { replica } = await openDevice(createFakeCell(), "tab");
  const { id } = await replica.createNote({ blocks: [], folderId: null, tags: [], title: NOTE });
  await replica.sync();
  await replica.write(id, {
    annotations: [
      {
        createdAt: 1,
        id: HIGHLIGHT,
        occurrence: null,
        op: "add",
        parentId: null,
        quote: "the passage",
        text: "",
      },
    ],
    ops: [],
  });
  const { library } = fakePageLibrary({ answer: () => ({}) });
  const entry = `/library?item=${id}`;
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }), {
    library: { ...library, replica },
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  return replica;
};

// the whole page at the library, over a replica and a cell's wire, with Save a link's dialog open
const askedToSaveALink = async () => {
  const { replica } = await openDevice(createFakeCell(), "tab");
  const { library } = fakePageLibrary({ answer: () => ({}) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/library"] }), {
    library: { ...library, replica },
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Save a link…" }));
  await screen.findByRole("textbox", { name: ADDRESS });
  return replica;
};

const submit = (address: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name: ADDRESS }), {
    target: { value: address },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
};

describe("Save a link", () => {
  it("keeps what was typed and says why when it is no web address", async () => {
    const replica = await askedToSaveALink();
    const saved = vi.spyOn(replica, "saveLink");

    submit("example.com");

    expect(screen.getByRole("textbox", { name: ADDRESS })).toHaveProperty("value", "example.com");
    expect(screen.getByRole("alert").textContent).toContain("https://");
    expect(saved).not.toHaveBeenCalled();
    await replica.close();
  });

  it("saves a web address and closes", async () => {
    const replica = await askedToSaveALink();
    const said = vi.spyOn(toast, "success");

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe("Saved.");
    });
    expect(screen.queryByRole("textbox", { name: ADDRESS })).toBeNull();
    await replica.close();
  });

  it("says so when the save itself fails", async () => {
    const replica = await askedToSaveALink();
    const failed = vi.spyOn(toast, "error");
    vi.spyOn(replica, "saveLink").mockRejectedValue(new Error("the replica's file is gone"));

    submit("https://example.com/page");

    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledWith("That link couldn't be saved.");
    });
    await replica.close();
  });
});

describe("Empty Deleted", () => {
  it("goes in the chunks the route takes, under one toast with Stop", async () => {
    const { replica } = await openDevice(createFakeCell(), "tab");
    const deleted = await Promise.all(
      Array.from(
        { length: BULK_ITEMS_MAX + 1 },
        async (_, at) =>
          await replica.saveLink({
            folderId: null,
            tags: [],
            url: `https://example.com/${String(at)}`,
          }),
      ),
    );
    await replica.deleteItems(deleted.map(({ id }) => id));
    const purge = z.object({ ids: z.array(z.string()) });
    const { calls, library } = fakePageLibrary({
      answer: ({ input }) => ({ purged: purge.parse(input).ids }),
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/library"] }), {
      library: { ...library, replica },
      queryClient: createPageQueryClient(),
    });
    const running = vi.spyOn(toast, "loading");
    const said = vi.spyOn(toast, "success");
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "Deleted" }));
    fireEvent.click(await screen.findByRole("button", { name: "Empty Deleted…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete forever" }));

    await vi.waitFor(() => {
      expect(said.mock.lastCall?.[0]).toBe(`Deleted ${String(BULK_ITEMS_MAX + 1)} items forever.`);
    });
    const chunks = calls
      .filter(({ path }) => path === "library.items.purge")
      .map(({ input }) => purge.parse(input).ids.length);
    expect(chunks).toStrictEqual([BULK_ITEMS_MAX, 1]);
    expect(running.mock.calls[0]?.[1]?.action).toMatchObject({ label: "Stop" });
    await replica.close();
  });
});

describe("an open item's title", () => {
  it("sets its own spell check off, as the body does", async () => {
    const replica = await pageOverANote();

    const title = await screen.findByRole("textbox", { name: "Title" });

    expect(title.getAttribute("spellcheck")).toBe("false");
    await replica.close();
  });
});

// the whole page at the library, with New note chosen from the Add menu and its item open
const madeANote = async () => {
  forgetPref(PREFS.libraryScope);
  const { replica } = await openDevice(createFakeCell(), "tab");
  const { library } = fakePageLibrary({ answer: () => ({}) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/library"] }), {
    library: { ...library, replica },
    queryClient: createPageQueryClient(),
  });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add to the library" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "New note" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  const id = z
    .string()
    .parse(new URL(router.history.location.href, "http://page").searchParams.get("item"));
  return { id, replica, title };
};

describe("a new note", () => {
  it("has no title of its own, and its field says so by its placeholder", async () => {
    const { id, replica, title } = await madeANote();

    expect(replica.row(id)?.fields.title).toBe("");
    expect(title).toHaveProperty("value", "");
    expect(title).toHaveProperty("placeholder", "Untitled");
    await replica.close();
  });

  it("goes by its first line until the person names it", async () => {
    const { id, replica, title } = await madeANote();

    await replica.write(id, {
      ops: [
        {
          block: { children: [{ text: "Groceries" }], id: "b1", type: "p" },
          op: "insert",
          ord: "a0",
          section: "note",
        },
      ],
    });
    expect(replica.row(id)?.title).toBe("Groceries");

    fireEvent.change(title, { target: { value: "Shopping" } });
    fireEvent.blur(title);
    await vi.waitFor(() => {
      expect(replica.row(id)?.title).toBe("Shopping");
    });
    await replica.close();
  });
});

describe("what the editor asks of the page", () => {
  it("makes a note in the folder of the item an open card folded onto", async () => {
    const cell = createFakeCell();
    const mac = await openDevice(cell, "mac");
    const folderId = mac.newId();
    await mac.replica.writeFolders([
      { id: folderId, name: "Reading", op: "create", parentId: null, sort: "a0" },
    ]);
    const url = "https://example.com/article";
    await mac.replica.saveLink({ folderId, tags: [], url });
    await mac.replica.sync();
    const { replica } = await openDevice(cell, "browser");
    const card = await replica.saveLink({ folderId: null, tags: [], url });
    await replica.sync();
    const { library } = fakePageLibrary({ answer: () => ({}) });
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: [`/library?item=${card.id}`] }),
      { library: { ...library, replica }, queryClient: createPageQueryClient() },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("textbox", { name: "Title" });

    const id = await getEditorHostActions().items.createNote({ blocks: [], title: "Extract" });

    expect(replica.row(id)?.fields.folderId).toBe(folderId);
    await replica.close();
  });

  it("quotes a passage asked about in the agent's composer, which takes the keyboard", async () => {
    const replica = await pageOverANote();
    await screen.findByRole("textbox", { name: "Title" });

    act(() => {
      getEditorHostActions().agent.askAboutSelection("the passage");
    });

    const field = await screen.findByRole("textbox", { name: "Message the agent" });
    await vi.waitFor(() => {
      expect(field).toHaveProperty("value", "> the passage\n\n");
    });
    expect(document.activeElement).toBe(field);
    await replica.close();
  });

  it("opens Highlights on the highlight it names, and brings it back when named again", async () => {
    const replica = await pageOverANote();
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    await screen.findByRole("textbox", { name: "Title" });

    act(() => {
      getEditorHostActions().annotations.open([HIGHLIGHT]);
    });

    const passage = await screen.findByRole("button", { name: "the passage" });
    const row = passage.closest("li");
    expect(row?.className).toContain("ring-highlight");
    await vi.waitFor(() => {
      expect(scrolled).toHaveBeenCalledOnce();
    });

    act(() => {
      getEditorHostActions().annotations.open([HIGHLIGHT]);
    });
    await vi.waitFor(() => {
      expect(scrolled).toHaveBeenCalledTimes(2);
    });
    await replica.close();
  });
});
