import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@repo/contract/test-support/deferred";

import { socketUrl } from "@repo/contract/library/library-socket";

import { createAccountSocket } from "./account-socket";
import { fakeSockets } from "./test-support/fake-sockets";

const ITEM = "01890a5d-ac96-774b-bcce-b302099a8057";
const MOVED = { folders: true, items: [{ id: ITEM, seq: 7 }], threads: "all", type: "moved" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// the ticket's await and the dial after it, and `ms` more
const pass = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

// a socket over the suite's sockets, recording every ticket asked, status and frame
const socketOver = (ticket: () => Promise<string> = async () => await Promise.resolve("t")) => {
  const { sockets, WebSocket } = fakeSockets();
  const statuses: string[] = [];
  const frames: unknown[] = [];
  let tickets = 0;
  const socket = createAccountSocket({
    onFrame: (frame) => {
      frames.push(frame);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
    origin: "https://cell.test",
    ticket: async () => {
      tickets += 1;
      return await ticket();
    },
    WebSocket,
  });
  return { frames, socket, sockets, statuses, tickets: () => tickets };
};

describe("the account's socket", () => {
  it("opens on its ticket at the origin's own scheme", () => {
    expect(socketUrl("https://inteligir.app", "t 1")).toBe(
      "wss://inteligir.app/v1/socket?ticket=t%201",
    );
    expect(socketUrl("http://localhost:5174", "t")).toBe("ws://localhost:5174/v1/socket?ticket=t");
  });

  it("says when it comes up, hands over each frame it reads, and skips what it cannot", async () => {
    const { frames, socket, sockets, statuses } = socketOver();
    socket.connect();
    await pass();
    const [live] = sockets;
    expect(live?.url).toBe("wss://cell.test/v1/socket?ticket=t");
    live?.open();
    live?.message(JSON.stringify(MOVED));
    live?.message("pong");
    live?.message("{not json");
    live?.message(JSON.stringify({ type: "from a newer cell" }));
    expect(statuses).toStrictEqual(["up"]);
    expect(frames).toStrictEqual([MOVED]);
    socket.close();
    expect(statuses).toStrictEqual(["up", "down"]);
  });

  it("pings while it hears the cell, and drops a socket gone silent", async () => {
    const { socket, sockets, statuses } = socketOver();
    socket.connect();
    await pass();
    sockets[0]?.open();
    await pass(45_000);
    expect(sockets[0]?.sent).toStrictEqual(["ping"]);
    sockets[0]?.message("pong");
    await pass(90_000);
    expect(sockets[0]?.closed).toBe(false);
    await pass(45_000);
    expect(sockets[0]?.closed).toBe(true);
    expect(statuses).toStrictEqual(["up", "down"]);
    await pass(1);
    expect(sockets).toHaveLength(2);
    socket.close();
  });

  it("dials again on a growing wait after a drop or a refused ticket, and never once closed", async () => {
    let asked = 0;
    const { socket, sockets, tickets } = socketOver(async () => {
      asked += 1;
      return asked === 2 ? await Promise.reject(new Error("no answer")) : "t";
    });
    socket.connect();
    await pass();
    sockets[0]?.drop();
    await pass(1000);
    expect(tickets()).toBe(2);
    expect(sockets).toHaveLength(1);
    await pass(1999);
    expect(sockets).toHaveLength(1);
    await pass(1);
    expect(sockets).toHaveLength(2);

    socket.close();
    sockets[1]?.drop();
    await pass(120_000);
    expect(sockets).toHaveLength(2);
  });

  it("dials nothing while the host is offline, and once when it is back", async () => {
    const { socket, sockets, statuses, tickets } = socketOver();
    socket.offline();
    socket.connect();
    await pass(120_000);
    expect(tickets()).toBe(0);

    socket.online();
    socket.online();
    await pass();
    expect(tickets()).toBe(1);
    sockets[0]?.open();
    socket.offline();
    expect(sockets[0]?.closed).toBe(true);
    expect(statuses).toStrictEqual(["up", "down"]);
    await pass(120_000);
    expect(tickets()).toBe(1);

    socket.online();
    await pass();
    expect(sockets).toHaveLength(2);
    socket.close();
  });

  it("opens one socket however a close and a connect meet a ticket on its way", async () => {
    const ticket = deferred();
    const { socket, sockets, tickets } = socketOver(async () => {
      await ticket.promise;
      return "t";
    });
    socket.connect();
    socket.close();
    socket.connect();
    ticket.resolve();
    await pass();
    socket.connect();
    await pass();
    expect(tickets()).toBe(1);
    expect(sockets).toHaveLength(1);
    socket.close();
    expect(sockets[0]?.closed).toBe(true);
  });

  it("lets a ticket asked before the host went offline dial nothing", async () => {
    const ticket = deferred();
    const { socket, sockets } = socketOver(async () => {
      await ticket.promise;
      return "t";
    });
    socket.connect();
    await pass();
    socket.offline();
    ticket.resolve();
    await pass();
    expect(sockets).toHaveLength(0);
  });
});
