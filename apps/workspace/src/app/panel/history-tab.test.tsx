// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { HistoryTab } from "./history-tab";

afterEach(cleanup);

const ITEM = "0199a4c2-0000-7000-8000-0000000000b1";

const set = (id: string, label: string) => ({
  actor: "person",
  closedAt: "2026-11-05T10:00:00.000Z",
  id,
  itemCount: 1,
  items: [{ created: false, deleted: false, id: ITEM, rev: 1, title: "Plans" }],
  label,
  openedAt: "2026-11-05T09:59:00.000Z",
  threadId: null,
  turn: null,
  undoneBy: null,
});

describe("an item's History", () => {
  it("reads older sets a page at a time, and undoes one after writing the open item", async () => {
    const flushOpen = vi.fn(async () => await Promise.resolve());
    const { calls, library } = fakePageLibrary({
      answer: ({ path, input }) => {
        if (path === "library.history.list") {
          // the newest page names the next; the older one is the last
          return JSON.stringify(input).includes('"cursor":"1"')
            ? { changeSets: [set("s1", "Typed in Plans")], cursor: null }
            : { changeSets: [set("s2", "Renamed Plans")], cursor: "1" };
        }
        return { changeSetId: "u1", kept: [], reverted: [ITEM] };
      },
    });
    renderOnLibrary(<HistoryTab itemId={ITEM} flushOpen={flushOpen} />, library);
    const list = await screen.findByRole("list", { name: "History" });
    expect(within(list).getByText("Renamed Plans")).toBeDefined();
    expect(within(list).queryByText("Typed in Plans")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    await screen.findByText("Typed in Plans");
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();

    const older = screen.getByText("Typed in Plans").closest("li");
    fireEvent.click(within(older ?? document.body).getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.history.undo")).toEqual([
        { input: { changeSetIds: ["s1"] }, path: "library.history.undo" },
      ]);
    });
    expect(flushOpen).toHaveBeenCalledOnce();
  });
});
