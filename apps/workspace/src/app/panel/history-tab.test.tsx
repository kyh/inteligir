// @vitest-environment jsdom

import { createORPCErrorFromJson } from "@orpc/client";
import { toast } from "@repo/ui/components/sonner";
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { HistoryTab } from "./history-tab";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

const ITEM = "0199a4c2-0000-7000-8000-0000000000b1";

const set = (id: string, label: string, undoneBy: string | null = null) => ({
  actor: "person",
  closedAt: "2026-11-05T10:00:00.000Z",
  id,
  itemCount: 1,
  items: [{ created: false, deleted: false, id: ITEM, rev: 1, title: "Plans" }],
  label,
  openedAt: "2026-11-05T09:59:00.000Z",
  threadId: null,
  turn: null,
  undoneBy,
});

// the tab, until "Leave" takes it away, and back
const Leaving = ({ flushOpen }: { flushOpen: () => Promise<void> }) => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        Leave
      </button>
      {open ? <HistoryTab itemId={ITEM} flushOpen={flushOpen} /> : null}
    </>
  );
};

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

  it("holds Undo from the press, and sends it once the open item is written", async () => {
    const written = Promise.withResolvers<null>();
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", "Renamed Plans")], cursor: null }
          : { changeSetId: "u1", kept: [], refused: [], reverted: [ITEM] },
    });
    renderOnLibrary(
      <HistoryTab
        itemId={ITEM}
        flushOpen={async () => {
          await written.promise;
        }}
      />,
      library,
    );
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    await waitFor(() => {
      expect(undo.hasAttribute("disabled")).toBe(true);
    });
    expect(calls.filter((call) => call.path === "library.history.undo")).toStrictEqual([]);
    written.resolve(null);
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.history.undo")).toHaveLength(1);
    });
  });

  it("keeps Undo down through leaving the tab and coming back", async () => {
    const { calls, library } = fakePageLibrary({
      answer: ({ path }) =>
        path === "library.history.list"
          ? { changeSets: [set("s1", "Renamed Plans")], cursor: null }
          : { changeSetId: "u1", kept: [], refused: [], reverted: [ITEM] },
    });
    renderOnLibrary(
      <Leaving
        flushOpen={async () => {
          await Promise.resolve();
        }}
      />,
      library,
    );
    const undo = await screen.findByRole("button", { name: "Undo" });
    act(() => {
      onlineManager.setOnline(false);
    });
    fireEvent.click(undo);
    const leave = screen.getByRole("button", { name: "Leave" });
    fireEvent.click(leave);
    fireEvent.click(leave);
    const back = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => {
      expect(back.hasAttribute("disabled")).toBe(true);
    });
    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "library.history.undo")).toHaveLength(1);
    });
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

  it("reads the list again when an undo is refused, so what another device took back shows", async () => {
    const said = vi.spyOn(toast, "error");
    const refusal = "That change was already undone.";
    let listed = [set("s1", "Renamed Plans")];
    const { library } = fakePageLibrary({
      answer: ({ path }) => {
        if (path === "library.history.list") {
          return { changeSets: listed, cursor: null };
        }
        throw createORPCErrorFromJson({
          code: "ALREADY_UNDONE",
          data: undefined,
          defined: true,
          message: refusal,
        });
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
    const undo = await screen.findByRole("button", { name: "Undo" });
    listed = [set("s1", "Renamed Plans", "u9")];
    fireEvent.click(undo);
    await waitFor(() => {
      expect(said).toHaveBeenCalledWith(refusal);
    });
    await screen.findByText(/undone$/u);
    expect(undo).toHaveProperty("disabled", true);
  });
});
