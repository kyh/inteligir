import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import type { FakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { forgetAccountStorage } from "./cloud/account-storage";
import { windowLayout } from "./prefs";
import { fakePageLibrary } from "./test-support/fake-page-library.test-utils";
import { addressed, openedOver, renderLibraryAt } from "./test-support/library-page.test-utils";

const pageAt = async (entry: string, cell: FakeCell) => {
  forgetAccountStorage();
  windowLayout.setState({ railClosed: [], railOpenNotes: [] });
  const { library } = fakePageLibrary({ cell });
  renderLibraryAt(entry, await openedOver(library));
};

const tree = async () => within(await screen.findByRole("list", { name: "Folders" }));

const seeded = () => {
  const cell = createFakeCell();
  const trips = cell.seed.folder("Trips");
  const lisbon = cell.seed.item({ parentId: trips, title: "Lisbon" });
  const day = cell.seed.item({ parentId: lisbon, title: "Day one" });
  const reading = cell.seed.item({ kind: "list", parentId: trips, title: "Reading" });
  const groceries = cell.seed.item({ title: "Groceries" });

  return { cell, day, groceries, lisbon, reading, trips };
};

describe("the library's tree in the sidebar", () => {
  it("lists a folder's lists and notes under it, and the notes at the root after the folders", async () => {
    const { cell } = seeded();
    await pageAt("/library", cell);
    const rows = await tree();

    const shown = [
      rows.getByRole("link", { name: /^Trips/u }),
      rows.getByRole("link", { name: /^Reading/u }),
      await rows.findByRole("button", { name: "Lisbon" }),
      await rows.findByRole("button", { name: "Groceries" }),
    ];

    for (const [at, row] of shown.slice(1).entries()) {
      expect(shown[at]?.compareDocumentPosition(row)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("closes a folder and remembers it, and opens a note that holds notes", async () => {
    const { cell, trips } = seeded();
    await pageAt("/library", cell);
    const rows = await tree();
    await rows.findByRole("button", { name: "Lisbon" });

    fireEvent.click(rows.getByRole("button", { name: "Open Lisbon" }));
    await rows.findByRole("button", { name: "Day one" });

    fireEvent.click(rows.getByRole("button", { name: "Close Trips" }));
    await waitFor(() => {
      expect(rows.queryByRole("button", { name: "Lisbon" })).toBeNull();
    });
    expect(windowLayout.getState().railClosed).toStrictEqual([trips]);
  });

  it("opens a note it lists, and shows a folder or list it lists", async () => {
    const { cell, groceries, reading } = seeded();
    await pageAt("/library", cell);
    const rows = await tree();

    fireEvent.click(await rows.findByRole("button", { name: "Groceries" }));
    await waitFor(() => {
      expect(addressed("item")).toBe(groceries);
    });

    fireEvent.click(rows.getByRole("link", { name: /Reading/u }));
    await waitFor(() => {
      expect(addressed("folder")).toBe(reading);
    });
  });
});
