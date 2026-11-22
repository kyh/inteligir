import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { environmentManager, focusManager, onlineManager, QueryClient } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";

import { createLibraryChanges } from "./library-changes";
import type { ItemsMoved } from "./library-cache";

const BEAT_MS = 60_000;

const HEAD_POLL_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  environmentManager.setIsServer(() => false);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  environmentManager.setIsServer(() => true);
  vi.useRealTimers();
});

const askingTab = () => {
  const cell = createFakeCell();
  const noteId = cell.seed.item({ title: "Note" });
  const { client } = cell.device("tab");
  const queries = createTanstackQueryUtils(client);
  const queryClient = new QueryClient();
  queryClient.mount();
  const changes = createLibraryChanges({ client, queries, queryClient });
  const moved: ItemsMoved[] = [];
  changes.onItems((items) => {
    moved.push(items);
  });
  const row = queries.library.items.row.queryKey({ input: { id: noteId } });
  const listing = queries.library.listing.titles.queryKey();
  queryClient.setQueryData(row, cell.held(noteId));
  queryClient.setQueryData(listing, { targets: [] });

  const stale = (key: typeof row | typeof listing) =>
    queryClient.getQueryState(key)?.isInvalidated === true;

  return {
    asks: () => cell.calls.filter((call) => call === "tab library/changes").length,
    changes,
    mac: cell.device("mac").client,
    moved,
    noteId,
    queryClient,
    stale: { listing: () => stale(listing), row: () => stale(row) },
    stop: () => {
      queryClient.unmount();
    },
  };
};

describe("what moved in the library, as a device asks it", () => {
  it("learns the head alone on its first ask", async () => {
    const tab = askingTab();
    await tab.mac.library.items.organize({ ids: [tab.noteId], title: "Renamed" });
    const stop = tab.changes.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(tab.asks()).toBe(1);
    expect(tab.stale.row()).toBe(false);
    expect(tab.stale.listing()).toBe(false);
    expect(tab.moved).toStrictEqual([]);
    stop();
    tab.stop();
  });

  it("marks stale the reads over what another device's write moved, and says which items", async () => {
    const tab = askingTab();
    const stop = tab.changes.start();
    await vi.advanceTimersByTimeAsync(0);

    await tab.mac.library.items.organize({ ids: [tab.noteId], title: "Renamed" });
    await vi.advanceTimersByTimeAsync(HEAD_POLL_MS);

    expect(tab.asks()).toBe(2);
    expect(tab.stale.row()).toBe(true);
    expect(tab.stale.listing()).toBe(true);
    expect(tab.moved).toStrictEqual([new Set([tab.noteId])]);
    stop();
    tab.stop();
  });

  it("asks again at once when the device comes back into focus or back online", async () => {
    const tab = askingTab();
    const stop = tab.changes.start();
    await vi.advanceTimersByTimeAsync(0);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.asks()).toBe(2);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.asks()).toBe(3);
    stop();
    tab.stop();
  });

  it("asks nothing while the device is in the background, and nothing once stopped", async () => {
    const tab = askingTab();
    const stop = tab.changes.start();
    await vi.advanceTimersByTimeAsync(0);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(4 * BEAT_MS);
    expect(tab.asks()).toBe(1);

    focusManager.setFocused(undefined);
    stop();
    await vi.advanceTimersByTimeAsync(4 * BEAT_MS);
    expect(tab.asks()).toBe(1);
    tab.stop();
  });

  it("applies an answer before a poll settles", async () => {
    const tab = askingTab();
    await tab.changes.poll();

    await tab.mac.library.items.organize({ ids: [tab.noteId], title: "Renamed" });
    await tab.changes.poll();

    expect(tab.asks()).toBe(2);
    expect(tab.stale.row()).toBe(true);
    tab.stop();
  });
});
