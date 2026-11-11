import { describe, expect, it } from "vitest";

import { deferred } from "../test-support/deferred";
import { fakeClock } from "../test-support/fake-clock";
import { fakeSockets } from "../test-support/fake-sockets";
import { createSocketHint, socketUrl } from "./account-socket";
import type { SocketHintArgs, SocketStatus } from "./account-socket";

const ITEM = "01890a5d-ac96-774b-bcce-b302099a8057";
const MOVED = JSON.stringify({
  folders: true,
  items: [{ id: ITEM, seq: 7 }],
  threads: "all",
  type: "moved",
});

// the ticket's await, and the dial after it
const settled = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
};

// a hint over a hand-run clock and sockets, recording every ticket asked, status and frame
const hintOver = (ticket: SocketHintArgs["ticket"] = async () => await Promise.resolve("t")) => {
  const clock = fakeClock();
  const { dial, sockets } = fakeSockets();
  const statuses: SocketStatus[] = [];
  const frames: unknown[] = [];
  let tickets = 0;
  const hint = createSocketHint({
    clock,
    dial,
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
  });
  return { clock, frames, hint, sockets, statuses, tickets: () => tickets };
};

describe("the account's socket, a hint", () => {
  it("opens on its ticket at the origin's own scheme", () => {
    expect(socketUrl("https://inteligir.app", "t 1")).toBe(
      "wss://inteligir.app/v1/socket?ticket=t%201",
    );
    expect(socketUrl("http://localhost:5174", "t")).toBe("ws://localhost:5174/v1/socket?ticket=t");
  });

  it("says when it comes up, hands over each frame it reads, and skips what it cannot", async () => {
    const { frames, hint, sockets, statuses } = hintOver();
    hint.connect();
    await settled();
    const [socket] = sockets;
    socket?.open();
    socket?.message(MOVED);
    socket?.message("pong");
    socket?.message("{not json");
    socket?.message(JSON.stringify({ type: "from a newer cell" }));
    expect(statuses).toStrictEqual(["up"]);
    expect(frames).toStrictEqual([
      { folders: true, items: [{ id: ITEM, seq: 7 }], threads: "all", type: "moved" },
    ]);
    hint.close();
  });

  it("pings while it hears the cell, and drops a socket gone silent", async () => {
    const { clock, hint, sockets, statuses } = hintOver();
    hint.connect();
    await settled();
    const [socket] = sockets;
    socket?.open();
    clock.advance(45_000);
    expect(socket?.sent).toStrictEqual(["ping"]);
    socket?.message("pong");
    clock.advance(45_000);
    expect(socket?.closed).toBe(false);
    clock.advance(90_000);
    expect(socket?.closed).toBe(true);
    expect(statuses).toStrictEqual(["up", "down"]);
    hint.close();
  });

  it("dials again on a doubling wait while it is wanted, and never once it is closed", async () => {
    let asked = 0;
    const { clock, hint, sockets, tickets } = hintOver(async () => {
      asked += 1;
      return asked === 2 ? await Promise.reject(new Error("no answer")) : "t";
    });
    hint.connect();
    await settled();
    sockets[0]?.drop();
    clock.advance(1000);
    await settled();
    expect(tickets()).toBe(2);
    expect(sockets).toHaveLength(1);
    clock.advance(1999);
    await settled();
    expect(tickets()).toBe(2);
    clock.advance(1);
    await settled();
    expect(sockets).toHaveLength(2);
    hint.close();
    sockets[1]?.drop();
    clock.advance(120_000);
    await settled();
    expect(sockets).toHaveLength(2);
  });

  it("waits and dials again after a ticket that fails, as it does after one that never came", async () => {
    let fails = true;
    const { clock, hint, sockets, tickets } = hintOver(async () => {
      if (fails) {
        throw new Error("the account could not be reached");
      }
      return await Promise.resolve("t");
    });
    hint.connect();
    await settled();
    expect(tickets()).toBe(1);
    expect(sockets).toHaveLength(0);
    fails = false;
    clock.advance(1000);
    await settled();
    expect(tickets()).toBe(2);
    expect(sockets).toHaveLength(1);
    hint.close();
  });

  it("dials once and at once when told to connect while a redial waits", async () => {
    const { clock, hint, sockets, tickets } = hintOver();
    hint.connect();
    await settled();
    sockets[0]?.drop();
    hint.connect();
    await settled();
    expect(tickets()).toBe(2);
    expect(sockets).toHaveLength(2);
    expect(clock.pending()).toBe(0);
    clock.advance(120_000);
    await settled();
    expect(sockets).toHaveLength(2);
    hint.close();
  });

  it("dials nothing while the host is offline, and once when it is back", async () => {
    const { clock, hint, sockets, statuses, tickets } = hintOver();
    hint.offline();
    hint.connect();
    clock.advance(120_000);
    await settled();
    expect(tickets()).toBe(0);

    hint.online();
    hint.online();
    await settled();
    expect(tickets()).toBe(1);
    sockets[0]?.open();
    hint.offline();
    expect(sockets[0]?.closed).toBe(true);
    expect(statuses).toStrictEqual(["up", "down"]);
    clock.advance(120_000);
    await settled();
    expect(tickets()).toBe(1);

    hint.online();
    await settled();
    expect(sockets).toHaveLength(2);
    hint.close();
  });

  it("lets a ticket asked before the host went offline dial nothing", async () => {
    const ticket = deferred();
    const { hint, sockets } = hintOver(async () => {
      await ticket.promise;
      return "t";
    });
    hint.connect();
    hint.offline();
    ticket.resolve();
    await settled();
    expect(sockets).toHaveLength(0);
  });

  it("says down each time an open socket goes, and only then", async () => {
    const { clock, hint, sockets, statuses } = hintOver();
    hint.connect();
    await settled();
    sockets[0]?.drop();
    expect(statuses).toStrictEqual([]);
    clock.advance(1000);
    await settled();
    sockets[1]?.open();
    sockets[1]?.drop();
    clock.advance(1000);
    await settled();
    sockets[2]?.open();
    hint.close();
    hint.close();
    expect(statuses).toStrictEqual(["up", "down", "up", "down"]);
  });

  it("acts on nothing an earlier socket says once another is dialled", async () => {
    const { clock, frames, hint, sockets, statuses } = hintOver();
    hint.connect();
    await settled();
    const [first] = sockets;
    first?.open();
    first?.drop();
    clock.advance(1000);
    await settled();
    expect(sockets).toHaveLength(2);
    first?.open();
    first?.message(MOVED);
    first?.drop();
    expect(statuses).toStrictEqual(["up", "down"]);
    expect(frames).toStrictEqual([]);
    clock.advance(120_000);
    await settled();
    expect(sockets).toHaveLength(2);
    hint.close();
  });

  it("opens one socket however a close and a connect meet a ticket on its way", async () => {
    const tickets: ReturnType<typeof deferred>[] = [];
    const { hint, sockets } = hintOver(async () => {
      const ticket = deferred();
      tickets.push(ticket);
      await ticket.promise;
      return "a-ticket";
    });
    hint.connect();
    hint.close();
    hint.connect();
    tickets[0]?.resolve();
    await settled();
    hint.connect();
    await settled();
    expect(tickets).toHaveLength(2);
    for (const ticket of tickets) {
      ticket.resolve();
    }
    await settled();
    expect(sockets).toHaveLength(1);
    hint.close();
    expect(sockets[0]?.closed).toBe(true);
  });
});
