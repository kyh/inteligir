// @vitest-environment jsdom

import { createORPCErrorFromJson } from "@orpc/client";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { heldItem } from "../test-support/cell-rows";
import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import type { CellCall } from "../test-support/fake-page-library";
import { InfoTab } from "./info-tab";

afterEach(cleanup);

const ITEM = "0199a4c2-0000-7000-8000-0000000000a1";
const FOLDER = "0199a4c2-0000-7000-8000-0000000000f1";

const answer = ({ path }: CellCall) => {
  switch (path) {
    case "library.items.get": {
      return heldItem(ITEM, {
        folderId: FOLDER,
        kind: "link",
        tags: ["reading"],
        title: "An article",
        url: "https://example.com/article",
      });
    }
    case "library.listing.scopes": {
      return {
        deleted: 0,
        folders: [{ id: FOLDER, items: 1, name: "Reading", parentId: null, sort: "a0" }],
        tags: [],
        total: 1,
        unsorted: 0,
        untagged: 0,
      };
    }
    default: {
      return { items: [] };
    }
  }
};

const noActions = () => ({
  move: vi.fn<(itemId: string) => void>(),
  tag: vi.fn<(itemId: string, tags: readonly string[]) => void>(),
});

const pinned = (): HTMLElement => screen.getByRole("switch", { name: "Pinned" });

describe("Info over an item", () => {
  it("draws the item as the cell holds it, and acts on it by its id", async () => {
    const { calls, library } = fakePageLibrary({ answer });
    const tag = vi.fn<(itemId: string, tags: readonly string[]) => void>();
    const move = vi.fn<(itemId: string) => void>();

    renderOnLibrary(<InfoTab itemId={ITEM} session={null} actions={{ move, tag }} />, library);
    await screen.findByText("Reading");
    fireEvent.click(screen.getByRole("button", { name: "Tag…" }));
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the page again" }));

    expect(tag).toHaveBeenCalledWith(ITEM, ["reading"]);
    expect(move).toHaveBeenCalledWith(ITEM);
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.items.refresh")).toStrictEqual([
        { input: { id: ITEM }, path: "library.items.refresh" },
      ]);
    });
  });

  it("pins the item at once, before the cell answers", async () => {
    const landed = Promise.withResolvers<null>();
    const { calls, library } = fakePageLibrary({
      answer: async (call) => {
        if (call.path === "library.items.organize") {
          await landed.promise;
        }
        return answer(call);
      },
    });

    renderOnLibrary(<InfoTab itemId={ITEM} session={null} actions={noActions()} />, library);
    await screen.findByText("Reading");
    expect(pinned().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(pinned());

    await waitFor(() => {
      expect(pinned().getAttribute("aria-checked")).toBe("true");
    });
    expect(calls.filter((call) => call.path === "library.items.organize")).toMatchObject([
      { input: { ids: [ITEM], pinned: true }, path: "library.items.organize" },
    ]);
    landed.resolve(null);
  });

  it("says the item is not here when the cell holds no such item", async () => {
    const { library } = fakePageLibrary({
      answer: (call) => {
        if (call.path === "library.items.get") {
          throw createORPCErrorFromJson({
            code: "NOT_FOUND",
            data: undefined,
            defined: true,
            message: "No such item.",
          });
        }
        return answer(call);
      },
    });

    renderOnLibrary(<InfoTab itemId={ITEM} session={null} actions={noActions()} />, library);

    await expect(screen.findByText("This item isn’t here.")).resolves.toBeDefined();
  });
});
