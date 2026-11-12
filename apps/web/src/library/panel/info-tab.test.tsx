// @vitest-environment jsdom

import { deferred } from "@repo/contract/deferred";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { InfoTab } from "./info-tab";

afterEach(cleanup);

// a cell holding a link filed in a folder and tagged
const cellWithALink = () => {
  const cell = createFakeCell();
  const folderId = cell.seed.folder("Reading");
  const id = cell.seed.item({
    fetchState: "filled",
    folderId,
    kind: "link",
    tags: ["reading"],
    title: "An article",
    url: "https://example.com/article",
  });
  return { cell, id };
};

const noActions = () => ({
  move: vi.fn<(itemId: string) => void>(),
  tag: vi.fn<(itemId: string, tags: readonly string[]) => void>(),
});

const pinned = (): HTMLElement => screen.getByRole("switch", { name: "Pinned" });

describe("Info over an item", () => {
  it("draws the item as the cell holds it, and acts on it by its id", async () => {
    const { cell, id } = cellWithALink();
    const { calls, library } = fakePageLibrary({ cell });
    const tag = vi.fn<(itemId: string, tags: readonly string[]) => void>();
    const move = vi.fn<(itemId: string) => void>();

    renderOnLibrary(<InfoTab itemId={id} actions={{ move, tag }} />, library);
    await screen.findByText("Reading");
    fireEvent.click(screen.getByRole("button", { name: "Tag…" }));
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the page again" }));

    expect(tag).toHaveBeenCalledWith(id, ["reading"]);
    expect(move).toHaveBeenCalledWith(id);
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.items.refresh")).toStrictEqual([
        { input: { id }, path: "library.items.refresh" },
      ]);
    });
    await waitFor(() => {
      expect(cell.item(id)?.fields.fetchState).toBe("pending");
    });
  });

  it("pins the item at once, before the cell answers", async () => {
    const { cell, id } = cellWithALink();
    const landed = deferred();
    const { calls, library } = fakePageLibrary({
      answer: async (call) => {
        if (call.path === "library.items.organize") {
          await landed.promise;
        }
      },
      cell,
    });

    renderOnLibrary(<InfoTab itemId={id} actions={noActions()} />, library);
    await screen.findByText("Reading");
    expect(pinned().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(pinned());

    await waitFor(() => {
      expect(pinned().getAttribute("aria-checked")).toBe("true");
    });
    expect(calls.filter((call) => call.path === "library.items.organize")).toMatchObject([
      { input: { ids: [id], pinned: true }, path: "library.items.organize" },
    ]);
    expect(cell.item(id)?.fields.pinnedAt).toBeNull();
    landed.resolve();
    await waitFor(() => {
      expect(cell.item(id)?.fields.pinnedAt).not.toBeNull();
    });
  });

  it("says the item is not here when the cell holds no such item", async () => {
    const { library } = fakePageLibrary();

    renderOnLibrary(
      <InfoTab itemId="0199a4c2-0000-7000-8000-0000000000a1" actions={noActions()} />,
      library,
    );

    await expect(screen.findByText("This item isn’t here.")).resolves.toBeDefined();
  });

  it("adds a property at once, as one field op over the item, and reads none of its body", async () => {
    const { cell, id } = cellWithALink();
    const landed = deferred();
    const { calls, library } = fakePageLibrary({
      answer: async (call) => {
        if (call.path === "library.write") {
          await landed.promise;
        }
      },
      cell,
    });

    renderOnLibrary(<InfoTab itemId={id} actions={noActions()} />, library);
    await screen.findByText("Reading");
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    fireEvent.change(screen.getByPlaceholderText("Property"), { target: { value: "status" } });
    fireEvent.change(screen.getByPlaceholderText("Value"), { target: { value: "draft" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Value"), { key: "Enter" });

    await screen.findByDisplayValue("draft");
    expect(calls.filter((call) => call.path === "library.write")).toMatchObject([
      { input: { itemId: id, ops: [{ key: "status", op: "property", value: "draft" }] } },
    ]);
    expect(cell.item(id)?.fields.properties).toStrictEqual({});
    landed.resolve();
    await waitFor(() => {
      expect(cell.item(id)?.fields.properties).toStrictEqual({ status: "draft" });
    });
    expect(calls.some((call) => call.path === "library.items.get")).toBe(false);
  });

  it("draws an item in Deleted's properties as they are, with nothing to edit", async () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ deletedAt: 1, properties: { status: "draft" }, title: "Gone" });
    const { library } = fakePageLibrary({ cell });

    renderOnLibrary(<InfoTab itemId={id} actions={noActions()} />, library);

    await screen.findByText("draft");
    expect(screen.queryByRole("button", { name: "Add property" })).toBeNull();
  });
});
