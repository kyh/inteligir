import { createORPCErrorFromJson } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";

import { createLibrarySocket, createThreadPreviews, retryUnlessRefused } from "./library-cache";
import type { ItemsMoved } from "./library-cache";
import { fakeSockets } from "./test-support/fake-sockets";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";
const OTHER_THREAD = "0199a4c2-0000-7000-8000-0000000000e2";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// a device's socket over a cell holding two notes, open, with every query a screen reads held once
const openSocket = async () => {
  const cell = createFakeCell();
  const note = cell.held(cell.seed.item({ title: "Note" }));
  const other = cell.held(cell.seed.item({ title: "Other" }));
  const { client } = cell.device("tab");
  const queries = createTanstackQueryUtils(client);
  const { agent, items, listing } = queries.library;
  const queryClient = new QueryClient();
  const keys = {
    events: agent.events.queryKey({ input: { threadId: THREAD } }),
    note: items.row.queryKey({ input: { id: note.id } }),
    other: items.get.queryKey({ input: { id: other.id } }),
    page: listing.page.queryKey({ input: { limit: 20, query: { deleted: false, sort: "saved" } } }),
    scopes: listing.scopes.queryKey(),
    threads: agent.list.queryKey({ input: {} }),
    titles: listing.titles.queryKey(),
  } satisfies Record<string, QueryKey>;
  const { sockets, WebSocket } = fakeSockets();
  const socket = createLibrarySocket({
    client,
    origin: "https://library.test",
    queries,
    queryClient,
    WebSocket,
  });
  const moved: ItemsMoved[] = [];
  socket.onItems((ids) => {
    moved.push(ids);
  });
  // the next socket dialled, opened, and every query a screen reads held after it came up
  const opened = async () => {
    await vi.advanceTimersByTimeAsync(1000);
    const live = sockets.at(-1);
    live?.open();
    queryClient.setQueryData(keys.note, note);
    queryClient.setQueryData(keys.other, other);
    // each key as the cache files it, whatever the query reads
    const held: readonly QueryKey[] = [
      keys.events,
      keys.page,
      keys.scopes,
      keys.threads,
      keys.titles,
    ];
    for (const key of held) {
      queryClient.setQueryData(key, "held");
    }
    return live;
  };
  socket.connect();
  const first = await opened();
  moved.length = 0;
  const stale = (queryKey: QueryKey): boolean =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  return {
    hear: (frame: LibrarySocketFrame) => {
      sockets.at(-1)?.message(JSON.stringify(frame));
    },
    moved,
    note,
    other,
    previews: socket.previews,
    // the dropped socket's wait, and the next one up
    redial: async () => {
      await vi.advanceTimersByTimeAsync(1000);
      sockets.at(-1)?.open();
    },
    socket: first,
    staleOf: () =>
      Object.entries(keys)
        .filter(([, key]) => stale(key))
        .map(([name]) => name)
        .toSorted(),
  };
};

describe("what the account's socket reads again", () => {
  it("reads everything again each time it comes up, since a drop may have hidden a write", async () => {
    const device = await openSocket();
    device.socket?.drop();
    expect(device.staleOf()).toStrictEqual([]);
    await device.redial();
    expect(device.staleOf()).toStrictEqual([
      "events",
      "note",
      "other",
      "page",
      "scopes",
      "threads",
      "titles",
    ]);
    expect(device.moved).toStrictEqual([null]);
  });

  it("reads again an item it holds an older copy of, and what the library lists, and no more", async () => {
    const { hear, moved, note, other, staleOf } = await openSocket();
    hear({
      folders: false,
      items: [
        { id: note.id, seq: note.seq + 1 },
        { id: other.id, seq: other.seq },
      ],
      threads: [],
      type: "moved",
    });
    expect(staleOf()).toStrictEqual(["note", "page", "scopes", "titles"]);
    expect(moved).toStrictEqual([new Set([note.id, other.id])]);
  });

  it("reads again the rail's scopes for a folder that moved, and a thread for its turn", async () => {
    const { hear, moved, staleOf } = await openSocket();
    hear({ folders: true, items: [], threads: [THREAD], type: "moved" });
    expect(staleOf()).toStrictEqual(["events", "scopes", "threads"]);
    expect(moved).toStrictEqual([]);
  });

  it("reads every item again when a write moved more than a frame names", async () => {
    const { hear, moved, staleOf } = await openSocket();
    hear({ folders: false, items: "all", threads: [], type: "moved" });
    expect(staleOf()).toStrictEqual(["note", "other", "page", "scopes", "titles"]);
    expect(moved).toStrictEqual([null]);
  });

  it("holds the reply being written, reading nothing, until a write moves its thread", async () => {
    const { hear, previews, staleOf } = await openSocket();
    hear({ text: "Filing", threadId: THREAD, type: "preview" });
    hear({ text: "Look", threadId: OTHER_THREAD, type: "preview" });
    expect(staleOf()).toStrictEqual([]);
    expect(previews.get(THREAD)).toBe("Filing");
    hear({ folders: false, items: [], threads: [THREAD], type: "moved" });
    expect(previews.get(THREAD)).toBeNull();
    expect(previews.get(OTHER_THREAD)).toBe("Look");
    hear({ folders: false, items: [], threads: "all", type: "moved" });
    expect(previews.get(OTHER_THREAD)).toBeNull();
  });

  it("lets every reply being written go the moment it goes down", async () => {
    const device = await openSocket();
    device.hear({ text: "Filing", threadId: THREAD, type: "preview" });
    device.socket?.drop();
    expect(device.previews.get(THREAD)).toBeNull();
    expect(device.staleOf()).toStrictEqual([]);
  });
});

const defined = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

describe("a read that did not land", () => {
  it("is asked again when it met no answer or a busy cell, never for a refusal", () => {
    expect(retryUnlessRefused(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryUnlessRefused(0, defined("TOO_MANY_REQUESTS"))).toBe(true);
    expect(retryUnlessRefused(3, new TypeError("Failed to fetch"))).toBe(false);
    expect(retryUnlessRefused(0, defined("NOT_FOUND"))).toBe(false);
    expect(retryUnlessRefused(0, defined("UNAUTHORIZED"))).toBe(false);
  });
});

describe("the reply being written", () => {
  it("tells a screen only when a thread's text moved", () => {
    const previews = createThreadPreviews();
    let told = 0;
    const unsubscribe = previews.subscribe(() => {
      told += 1;
    });
    previews.hear({ text: null, threadId: null });
    previews.hear({ text: "Filing", threadId: THREAD });
    previews.hear({ text: "Filing", threadId: THREAD });
    previews.hear({ text: null, threadId: OTHER_THREAD });
    expect(told).toBe(1);
    previews.hear({ text: null, threadId: null });
    expect(told).toBe(2);
    unsubscribe();
    previews.hear({ text: "Filed", threadId: THREAD });
    expect(told).toBe(2);
  });
});
