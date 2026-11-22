import { deferred } from "@repo/contract/deferred";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { toast } from "@repo/ui/components/sonner";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakePageLibrary,
  renderOnLibrary,
  spyCommands,
} from "../test-support/fake-page-library.test-utils";
import { InfoTab } from "./info-tab";

afterEach(() => {
  vi.restoreAllMocks();
});

const cellWithALink = () => {
  const cell = createFakeCell();
  const parentId = cell.seed.folder("Reading");

  const id = cell.seed.item({
    parentId,
    kind: "link",
    reading: { at: 1_700_000_000_000, state: "read" },
    tags: ["reading"],
    title: "An article",
    url: "https://example.com/article",
  });

  return { cell, id };
};

const pinned = () => screen.getByRole("switch", { name: "Pinned" });

describe("Info over an item", () => {
  it("draws the item as the cell holds it, and acts on it by its id", async () => {
    const { cell, id } = cellWithALink();
    const { calls, library } = fakePageLibrary({ cell });
    const commands = spyCommands();

    renderOnLibrary(<InfoTab itemId={id} />, library, commands);
    await screen.findByText("Reading");
    fireEvent.click(screen.getByRole("button", { name: "Tag…" }));
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the page again" }));

    expect(commands.tag).toHaveBeenCalledWith({ ids: [id], kind: "ids" }, [["reading"]]);
    expect(commands.move).toHaveBeenCalledWith({ ids: [id], kind: "ids" });
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.items.refresh")).toStrictEqual([
        { input: { id }, path: "library.items.refresh" },
      ]);
    });
    await waitFor(() => {
      expect(cell.item(id)?.fields.reading.state).toBe("pending");
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

    renderOnLibrary(<InfoTab itemId={id} />, library);
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

  it("says why the cell refused a pin, and puts the switch back", async () => {
    const { cell, id } = cellWithALink();

    const { library } = fakePageLibrary({
      answer: (call) => {
        if (call.path === "library.items.organize") {
          throw new Error("the cell is down");
        }
      },
      cell,
    });

    const failed = vi.spyOn(toast, "error");

    renderOnLibrary(<InfoTab itemId={id} />, library);
    await screen.findByText("Reading");
    fireEvent.click(pinned());

    await waitFor(() => {
      expect(failed).toHaveBeenCalledWith("That couldn't be pinned.");
    });
    await waitFor(() => {
      expect(pinned().getAttribute("aria-checked")).toBe("false");
    });
  });

  it("says the item is not here when the cell holds no such item", async () => {
    const { library } = fakePageLibrary();

    renderOnLibrary(<InfoTab itemId="0199a4c2-0000-7000-8000-0000000000a1" />, library);

    await expect(screen.findByText("This item isn’t here.")).resolves.toBeDefined();
  });

  it("adds a property at once, as one property op over the item, and reads none of its body", async () => {
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

    renderOnLibrary(<InfoTab itemId={id} />, library);
    await screen.findByText("Reading");
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "status" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

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

  it("closes Add, and what was typed in it, as Info moves to another item it has read", async () => {
    const cell = createFakeCell();
    const first = cell.seed.item({ tags: ["first"] });
    const second = cell.seed.item({ tags: ["second"] });
    const { library } = fakePageLibrary({ cell });

    const { rerender } = renderOnLibrary(<InfoTab itemId={second} />, library);
    await screen.findByText("#second");
    rerender(<InfoTab itemId={first} />);
    await screen.findByText("#first");
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "status" },
    });
    rerender(<InfoTab itemId={second} />);

    expect(screen.getByText("#second")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add property" })).toBeDefined();
  });

  it("draws an item in Deleted's properties as they are, with nothing to edit", async () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ deletedAt: 1, properties: { status: "draft" }, title: "Gone" });
    const { library } = fakePageLibrary({ cell });

    renderOnLibrary(<InfoTab itemId={id} />, library);

    await screen.findByText("draft");
    expect(screen.queryByRole("button", { name: "Add property" })).toBeNull();
  });
});
