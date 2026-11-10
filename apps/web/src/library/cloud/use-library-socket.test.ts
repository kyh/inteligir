import type { ThreadFrame } from "@repo/agent-panel/thread-previews";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import { fakeClock } from "@repo/contract/test-support/fake-clock";
import { fakeSockets } from "@repo/contract/test-support/fake-sockets";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { fakePageLibrary } from "../test-support/fake-page-library";
import { createLibrarySocket } from "./use-library-socket";
import type { ItemsMoved } from "./use-library-socket";
import { createPageQueryClient } from "./v1";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

// the page's socket over a cell holding two notes, with every query the page reads held once
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
  const sockets = fakeSockets();
  const socket = createLibrarySocket({
    clock: fakeClock(),
    dial: sockets.dial,
    origin: "https://library.test",
    queryClient,
    wire,
  });
  const items: ItemsMoved[] = [];
  const threads: ThreadFrame[] = [];
  socket.onItems((moved) => {
    items.push(moved);
  });
  socket.onThread((frame) => {
    threads.push(frame);
  });
  socket.connect();
  await vi.waitFor(() => {
    expect(sockets.sockets).toHaveLength(1);
  });
  const [dialled] = sockets.sockets;
  if (dialled === undefined) {
    throw new Error("the socket was never dialled");
  }
  const stale = (queryKey: QueryKey): boolean =>
    queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
  return {
    hear: (frame: LibrarySocketFrame) => {
      dialled.message(JSON.stringify(frame));
    },
    items,
    keys,
    note,
    open: dialled.open,
    other,
    staleOf: () => Object.entries(keys).flatMap(([name, key]) => (stale(key) ? [name] : [])),
    threads,
  };
};

describe("the account's socket on this page", () => {
  it("reads everything again each time it opens, since a drop may have hidden a write", async () => {
    const socket = await openSocket();

    socket.open();

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

  it("reads a thread's stored events again, and hands every thread frame on", async () => {
    const socket = await openSocket();

    socket.hear({ event: { text: "Fil" }, preview: true, threadId: THREAD, type: "thread" });
    expect(socket.staleOf()).toStrictEqual([]);
    socket.hear({ event: {}, preview: false, threadId: THREAD, type: "thread" });

    expect(socket.staleOf()).toStrictEqual(["events"]);
    expect(socket.threads.map((frame) => frame.preview)).toStrictEqual([true, false]);
  });
});
