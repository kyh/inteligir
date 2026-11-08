import { describe, expect, it } from "vitest";

import { deferred } from "../../test-support/deferred";
import { fakeClock } from "../../test-support/fake-clock";
import { fakeSockets } from "../../test-support/fake-sockets";
import { createSocketHint, socketUrl } from "./account-socket";

const ITEM = "01890a5d-ac96-774b-bcce-b302099a8057";

// the ticket's await, and the dial after it
const settled = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
};

describe("the account's socket, a hint", () => {
  it("opens on its ticket at the origin's own scheme", () => {
    expect(socketUrl("https://inteligir.app", "t 1")).toBe(
      "wss://inteligir.app/v1/socket?ticket=t%201",
    );
    expect(socketUrl("http://localhost:5174", "t")).toBe("ws://localhost:5174/v1/socket?ticket=t");
  });

  it("says when it opens, hands over each frame it reads, and skips what it cannot", async () => {
    const clock = fakeClock();
    const { dial, sockets } = fakeSockets();
    const frames: unknown[] = [];
    let opened = 0;
    const hint = createSocketHint({
      clock,
      dial,
      onFrame: (frame) => {
        frames.push(frame);
      },
      onOpen: () => {
        opened += 1;
      },
      origin: "https://cell.test",
      ticket: async () => await Promise.resolve("a-ticket"),
    });
    hint.connect();
    await settled();
    const [socket] = sockets;
    socket?.open();
    socket?.message(
      JSON.stringify({
        folders: true,
        items: [{ id: ITEM, seq: 7 }],
        threads: "all",
        type: "moved",
      }),
    );
    socket?.message("pong");
    socket?.message("{not json");
    socket?.message(JSON.stringify({ type: "from a newer cell" }));
    expect(opened).toBe(1);
    expect(frames).toStrictEqual([
      { folders: true, items: [{ id: ITEM, seq: 7 }], threads: "all", type: "moved" },
    ]);
    hint.close();
  });

  it("pings while it hears the cell, and drops a socket gone silent", async () => {
    const clock = fakeClock();
    const { dial, sockets } = fakeSockets();
    const hint = createSocketHint({
      clock,
      dial,
      onFrame: () => {},
      onOpen: () => {},
      origin: "https://cell.test",
      ticket: async () => await Promise.resolve("a-ticket"),
    });
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
    hint.close();
  });

  it("dials again on a doubling wait while it is wanted, and never once it is closed", async () => {
    const clock = fakeClock();
    const { dial, sockets } = fakeSockets();
    let tickets = 0;
    const hint = createSocketHint({
      clock,
      dial,
      onFrame: () => {},
      onOpen: () => {},
      origin: "https://cell.test",
      ticket: async () => {
        tickets += 1;
        return await Promise.resolve(tickets === 2 ? null : "a-ticket");
      },
    });
    hint.connect();
    await settled();
    sockets[0]?.drop();
    clock.advance(1000);
    await settled();
    expect(tickets).toBe(2);
    expect(sockets).toHaveLength(1);
    clock.advance(1999);
    await settled();
    expect(tickets).toBe(2);
    clock.advance(1);
    await settled();
    expect(sockets).toHaveLength(2);
    hint.close();
    sockets[1]?.drop();
    clock.advance(120_000);
    await settled();
    expect(sockets).toHaveLength(2);
  });

  it("opens one socket however a close and a connect meet a ticket on its way", async () => {
    const clock = fakeClock();
    const { dial, sockets } = fakeSockets();
    const tickets: ReturnType<typeof deferred>[] = [];
    const hint = createSocketHint({
      clock,
      dial,
      onFrame: () => {},
      onOpen: () => {},
      origin: "https://cell.test",
      ticket: async () => {
        const ticket = deferred();
        tickets.push(ticket);
        await ticket.promise;
        return "a-ticket";
      },
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
