// @vitest-environment jsdom

import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice } from "@repo/library-replica/test-support/replica-harness";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { InfoTab } from "./info-tab";

afterEach(cleanup);

describe("Info over a card that folded", () => {
  it("acts on the item the card landed on", async () => {
    const cell = createFakeCell();
    const url = "https://example.com/article";
    const mac = await openDevice(cell, "mac");
    const holder = await mac.replica.saveLink({ folderId: null, tags: [], url });
    await mac.replica.sync();
    const { replica } = await openDevice(cell, "browser");
    const card = await replica.saveLink({ folderId: null, tags: [], url });
    await replica.sync();
    const { calls, library } = fakePageLibrary({ answer: () => ({}) });
    const tag = vi.fn<(itemId: string) => void>();
    const move = vi.fn<(itemId: string) => void>();

    renderOnLibrary(<InfoTab itemId={card.id} session={null} actions={{ move, tag }} />, {
      ...library,
      replica,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Tag…" }));
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the page again" }));

    expect(tag).toHaveBeenCalledWith(holder.id);
    expect(move).toHaveBeenCalledWith(holder.id);
    await waitFor(() => {
      expect(calls).toStrictEqual([{ input: { id: holder.id }, path: "library.items.refresh" }]);
    });
    await replica.close();
  });
});
