// @vitest-environment jsdom

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { fakeClock } from "@repo/contract/test-support/fake-clock";
import { fakeSockets } from "@repo/contract/test-support/fake-sockets";
import { onlineManager } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary } from "../test-support/fake-page-library";
import { createLibrarySocket, useLibrarySocket } from "./use-library-socket";
import type { ItemsMoved, ThreadPreview } from "./use-library-socket";
import { createPageQueryClient } from "./v1";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

// the page's socket over a cell holding two notes, open, with every query the page reads held once
const openSocket = async () => {
  const cell = createFakeCell();
  const note = cell.held(cell.seed.item({ title: "Note" }));
  const other = cell.held(cell.seed.item({ title: "Other" }));
  const { wire } = fakePageLibrary({ cell }).library;
  const { orpc } = wire;
  const queryClient = createPageQueryClient();
  const keys = {
    events: orpc.library.agent.events.queryKey({ input: { threadId: THREAD } }),
    note: orpc.library.items.row.queryKey({ input: { id: note.id } }),
    other: orpc.library.items.row.queryKey({ input: { id: other.id } }),
    page: orpc.library.listing.page.queryKey({
      input: { limit: 20, query: { deleted: false, sort: "saved" } },
    }),
    scopes: orpc.library.listing.scopes.queryKey(),
    threads: orpc.library.agent.list.queryKey({ input: {} }),
    titles: orpc.library.listing.titles.queryKey(),
  };
  const clock = fakeClock();
  const sockets = fakeSockets();
  const socket = createLibrarySocket({
    clock,
    dial: sockets.dial,
    origin: "https://library.test",
    queryClient,
    wire,
  });
  const items: ItemsMoved[] = [];
  const previews: ThreadPreview[] = [];
  socket.onItems((moved) => {
    items.push(moved);
  });
  socket.onPreview((preview) => {
    previews.push(preview);
  });
  // the next socket the hint dials, opened
  const opened = async () => {
    const dialled = sockets.sockets.length;
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(dialled + 1);
    });
    const live = sockets.sockets.at(-1);
    if (live === undefined) {
      throw new Error("the socket was never dialled");
    }
    live.open();
    return live;
  };
  socket.connect();
  const live = await opened();
  // held after the socket came up, as what a screen reads once it draws
  queryClient.setQueryData(keys.note, note);
  queryClient.setQueryData(keys.other, other);
  queryClient.setQueryData(keys.events, { events: [], more: false });
  const kindCounts = { audio: 0, file: 0, image: 0, link: 0, note: 0, pdf: 0, video: 0 };
  queryClient.setQueryData(keys.page, { items: [], kindCounts, nextCursor: null, total: 0 });
  queryClient.setQueryData(keys.scopes, {
    deleted: 0,
    folders: [],
    tags: [],
    total: 0,
    unsorted: 0,
    untagged: 0,
  });
  queryClient.setQueryData(keys.threads, { cursor: null, threads: [] });
  queryClient.setQueryData(keys.titles, { targets: [] });
  items.length = 0;
  const stale = (queryKey: QueryKey): boolean =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  return {
    drop: live.drop,
    hear: (frame: LibrarySocketFrame) => {
      live.message(JSON.stringify(frame));
    },
    items,
    keys,
    note,
    other,
    previews,
    // the dropped socket's wait, and the next one up
    redial: async () => {
      clock.advance(1000);
      await opened();
    },
    staleOf: () => Object.entries(keys).flatMap(([name, key]) => (stale(key) ? [name] : [])),
  };
};

describe("the account's socket on this page", () => {
  it("reads everything again each time it comes up, since a drop may have hidden a write", async () => {
    const socket = await openSocket();

    socket.drop();
    expect(socket.staleOf()).toStrictEqual([]);
    await socket.redial();

    expect(socket.staleOf().toSorted()).toStrictEqual([
      "events",
      "note",
      "other",
      "page",
      "scopes",
      "threads",
      "titles",
    ]);
    expect(socket.items).toStrictEqual([null]);
  });

  it("reads again an item it holds an older copy of, and what the library lists, and no more", async () => {
    const socket = await openSocket();
    const { note, other } = socket;

    socket.hear({
      folders: false,
      items: [
        { id: note.id, seq: note.seq + 1 },
        { id: other.id, seq: other.seq },
      ],
      threads: [],
      type: "moved",
    });

    expect(socket.staleOf().toSorted()).toStrictEqual(["note", "page", "scopes", "titles"]);
    expect(socket.items).toStrictEqual([
      new Map([
        [note.id, note.seq + 1],
        [other.id, other.seq],
      ]),
    ]);
  });

  it("reads again the rail's scopes for a folder that moved, and a thread for its turn", async () => {
    const socket = await openSocket();

    socket.hear({ folders: true, items: [], threads: [THREAD], type: "moved" });

    expect(socket.staleOf().toSorted()).toStrictEqual(["events", "scopes", "threads"]);
    expect(socket.items).toStrictEqual([]);
    expect(socket.previews).toStrictEqual([{ text: null, threadId: THREAD }]);
  });

  it("reads every item again when a write moved more than a frame names", async () => {
    const socket = await openSocket();

    socket.hear({ folders: false, items: "all", threads: [], type: "moved" });

    expect(socket.staleOf().toSorted()).toStrictEqual([
      "note",
      "other",
      "page",
      "scopes",
      "titles",
    ]);
    expect(socket.items).toStrictEqual([null]);
  });

  it("hands on the reply being written, reading nothing, until a write moves its thread", async () => {
    const socket = await openSocket();

    socket.hear({ text: "Fil", threadId: THREAD, type: "preview" });
    socket.hear({ text: "Filed", threadId: THREAD, type: "preview" });
    expect(socket.staleOf()).toStrictEqual([]);
    socket.hear({ folders: false, items: [], threads: [THREAD], type: "moved" });
    socket.hear({ folders: false, items: [], threads: "all", type: "moved" });

    expect(socket.previews).toStrictEqual([
      { text: "Fil", threadId: THREAD },
      { text: "Filed", threadId: THREAD },
      { text: null, threadId: THREAD },
      { text: null, threadId: null },
    ]);
  });

  it("lets every reply being written go the moment it goes down", async () => {
    const socket = await openSocket();

    socket.hear({ text: "Fil", threadId: THREAD, type: "preview" });
    socket.drop();

    expect(socket.previews).toStrictEqual([
      { text: "Fil", threadId: THREAD },
      { text: null, threadId: null },
    ]);
    expect(socket.staleOf()).toStrictEqual([]);
  });
});

describe("the account's socket while the page shows the library", () => {
  it("dials nothing while the browser is offline, and at once when it is back", async () => {
    const sockets = fakeSockets();
    const page = fakePageLibrary();
    const socket = createLibrarySocket({
      clock: fakeClock(),
      dial: sockets.dial,
      origin: "https://library.test",
      queryClient: createPageQueryClient(),
      wire: page.library.wire,
    });
    onlineManager.setOnline(false);
    const shown = renderHook(() => {
      useLibrarySocket(socket);
    });
    expect(page.calls).toStrictEqual([]);

    onlineManager.setOnline(true);
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(1);
    });
    sockets.sockets[0]?.open();
    onlineManager.setOnline(false);
    expect(sockets.sockets[0]?.closed).toBe(true);

    onlineManager.setOnline(true);
    await vi.waitFor(() => {
      expect(sockets.sockets).toHaveLength(2);
    });
    shown.unmount();
    expect(sockets.sockets[1]?.closed).toBe(true);
  });
});
