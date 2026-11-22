import { NEW_LIST } from "@repo/contract/library/list-settings";
import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import type { FakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { forgetAccountStorage } from "../cloud/account-storage";
import { fakePageLibrary } from "../test-support/fake-page-library.test-utils";
import { addressed, openedOver, renderLibraryAt } from "../test-support/library-page.test-utils";

const pageAt = async (entry: string, cell: FakeCell) => {
  forgetAccountStorage();
  const { calls, library } = fakePageLibrary({ cell });
  renderLibraryAt(entry, await openedOver(library));

  return { calls };
};

const chord = (key: string) =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

const listOfThree = () => {
  const cell = createFakeCell();
  const list = cell.seed.item({ kind: "list", list: NEW_LIST, title: "Launch" });

  const note = (title: string, status?: string) =>
    cell.seed.item({
      parentId: list,
      properties: status === undefined ? {} : { Status: status },
      title,
    });

  return {
    cell,
    copy: note("Write the copy", "Done"),
    list,
    page: note("Landing page", "To do"),
    stray: note("Loose idea"),
  };
};

const groups = async () => {
  await screen.findByRole("region", { name: "To do" });

  return [...document.querySelectorAll<HTMLElement>("[data-list-group]")].map((region) => [
    region.getAttribute("aria-label"),
    within(region).queryAllByRole("listitem").length,
  ]);
};

describe("a list's view", () => {
  it("groups what it holds by its select, in the options' order, the unset last", async () => {
    const { cell, list } = listOfThree();
    await pageAt(`/library?folder=${list}`, cell);

    await expect(groups()).resolves.toStrictEqual([
      ["To do", 1],
      ["In progress", 0],
      ["Done", 1],
      ["No Status", 1],
    ]);
  });

  it("moves an item to another group by setting its property", async () => {
    const { cell, list, page } = listOfThree();
    await pageAt(`/library?folder=${list}`, cell);

    fireEvent.click(await screen.findByRole("button", { name: "More for Landing page" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Done" }));

    await waitFor(() => {
      expect(cell.item(page)?.fields.properties).toStrictEqual({ Status: "Done" });
    });
  });

  it("renames a property across what it holds and groups by none", async () => {
    const { cell, copy, list } = listOfThree();
    await pageAt(`/library?folder=${list}`, cell);

    fireEvent.click(await screen.findByRole("button", { name: "Properties" }));
    const name = await screen.findByRole("textbox", { name: "Name of Status" });
    fireEvent.change(name, { target: { value: "Stage" } });
    fireEvent.blur(name);

    await waitFor(() => {
      expect(cell.item(list)?.fields.list?.groupBy).toBe("Stage");
    });
    expect(cell.item(copy)?.fields.properties).toStrictEqual({ Stage: "Done" });

    fireEvent.click(screen.getByRole("button", { name: "Group by" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "None" }));
    await waitFor(() => {
      expect(cell.item(list)?.fields.list?.groupBy).toBeNull();
    });
  });

  it("makes a note in a group, set to that group, and opens it beside the list", async () => {
    const { cell, list } = listOfThree();
    await pageAt(`/library?folder=${list}`, cell);

    fireEvent.click(await screen.findByRole("button", { name: "New note in In progress" }));

    await waitFor(() => {
      expect(addressed("item")).not.toBeNull();
    });
    const made = cell.item(addressed("item") ?? "");
    expect(made?.fields.parentId).toBe(list);
    await waitFor(() => {
      expect(cell.item(addressed("item") ?? "")?.fields.properties).toStrictEqual({
        Status: "In progress",
      });
    });
    expect(addressed("folder")).toBe(list);
    expect(document.querySelector(`[data-list-view="${list}"]`)).not.toBeNull();
  });

  it("opens an item beside the list and steps through its rows with the list's keys", async () => {
    const { cell, copy, list, page, stray } = listOfThree();
    await pageAt(`/library?folder=${list}&item=${page}`, cell);

    await screen.findByRole("button", { name: "Resize the list" });
    await screen.findByRole("button", { name: "Loose idea" });

    fireEvent.keyDown(window, chord("]"));
    await waitFor(() => {
      expect(addressed("item")).toBe(copy);
    });
    fireEvent.keyDown(window, chord("]"));
    await waitFor(() => {
      expect(addressed("item")).toBe(stray);
    });
    fireEvent.keyDown(window, chord("["));
    await waitFor(() => {
      expect(addressed("item")).toBe(copy);
    });
  });
});
