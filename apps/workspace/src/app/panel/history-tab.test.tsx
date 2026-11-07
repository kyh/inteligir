// @vitest-environment jsdom

import { toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { HistoryTab } from "./history-tab";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  it("shows a version of a note with no title from its first words", async () => {
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", "Typed in Plans")], cursor: null }
          : {
              blocks: [
                {
                  block: { children: [{ text: "Groceries" }], id: "b1", type: "p" },
                  hash: "h",
                  ord: "a0",
                  section: "note",
                },
              ],
              fields: { title: "" },
              rev: 1,
            },
    });
    renderOnLibrary(
      <HistoryTab
        itemId={ITEM}
        flushOpen={async () => {
          await Promise.resolve();
        }}
      />,
      library,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show this version" }));
    const version = await within(await screen.findByRole("dialog")).findByText(/Groceries/u);
    expect(version.textContent?.startsWith("Groceries")).toBe(true);
  });

  it("reads older sets a page at a time, and undoes one after writing the open item", async () => {
    const flushOpen = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const { calls, library } = fakePageLibrary({
      answer: ({ path, input }) => {
        if (path === "library.history.list") {
          // the newest page names the next; the older one is the last
          return JSON.stringify(input).includes('"cursor":"1"')
            ? { changeSets: [set("s1", "Typed in Plans")], cursor: null }
            : { changeSets: [set("s2", "Renamed Plans")], cursor: "1" };
        }
        return { changeSetId: "u1", kept: [], refused: [], reverted: [ITEM] };
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
      expect(calls.filter((call) => call.path === "library.history.undo")).toStrictEqual([
        { input: { changeSetIds: ["s1"] }, path: "library.history.undo" },
      ]);
    });
    expect(flushOpen).toHaveBeenCalledOnce();
  });

  it("says so, and calls it no success, when a later change kept everything", async () => {
    const info = vi.spyOn(toast, "info");
    const success = vi.spyOn(toast, "success");
    const { library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", "Renamed Plans")], cursor: null }
          : { changeSetId: null, kept: [ITEM], refused: [], reverted: [] },
    });
    renderOnLibrary(
      <HistoryTab
        itemId={ITEM}
        flushOpen={async () => {
          await Promise.resolve();
        }}
      />,
      library,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/^Nothing was undone/u));
    });
    expect(success).not.toHaveBeenCalled();
  });
});
