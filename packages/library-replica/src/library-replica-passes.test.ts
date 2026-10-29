import { describe, expect, it, vi } from "vitest";

import { createFakeCell } from "./test-support/fake-cell";
import type { FakeCell, FakeDevice } from "./test-support/fake-cell";
import { fakeClock } from "./test-support/fake-clock";
import type { FakeClock } from "./test-support/fake-clock";
import { fakeSockets } from "./test-support/fake-sockets";
import { openDevice } from "./test-support/replica-harness";
import type { TestDevice } from "./test-support/replica-harness";

const THREAD = "01900000-0000-7000-8000-0000000000aa";

const pulls = (cell: FakeCell, device: string): number =>
  cell.calls.filter((call) => call === `${device} library/sync/pull`).length;

// the pass a timer, a frame or a write started has ended
const idle = async (device: TestDevice): Promise<void> => {
  await vi.waitFor(() => {
    expect(device.replica.status().syncing).toBe(false);
  });
};

// the clock moved on, and whatever pass that started has ended
const after = async (device: TestDevice, ms: number): Promise<void> => {
  device.clock.advance(ms);
  await idle(device);
};

// a device's network that counts every call it carries, the ones that never reach the cell too
interface CountedNetwork {
  readonly device: FakeDevice;
  readonly fetches: () => number;
}

const countedNetwork = (cell: FakeCell, name: string): CountedNetwork => {
  const network = cell.device(name);
  let fetches = 0;
  return {
    device: {
      ...network,
      transport: {
        fetch: async (request) => {
          fetches += 1;
          return await network.transport.fetch(request);
        },
        origin: network.transport.origin,
      },
    },
    fetches: () => fetches,
  };
};

// a clock that keeps each wait the engine asks of it, in the order it asks
interface RecordingClock {
  readonly clock: FakeClock;
  readonly asked: number[];
}

const recordingClock = (): RecordingClock => {
  const clock = fakeClock();
  const asked: number[] = [];
  return {
    asked,
    clock: {
      ...clock,
      after: (ms, run) => {
        asked.push(ms);
        return clock.after(ms, run);
      },
    },
  };
};

describe("when the replica syncs", () => {
  it("syncs as it starts, on every write and every minute while started, and not while suspended", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    phone.replica.start();
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(1);

    const written = await phone.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Sent at once",
    });
    await idle(phone);
    expect(cell.item(written.id)).not.toBeNull();
    const pulled = pulls(cell, "phone");

    await after(phone, 59_999);
    expect(pulls(cell, "phone")).toBe(pulled);
    await after(phone, 1);
    expect(pulls(cell, "phone")).toBe(pulled + 1);
    await after(phone, 60_000);
    expect(pulls(cell, "phone")).toBe(pulled + 2);

    phone.replica.suspend();
    expect(phone.clock.pending()).toBe(0);
    const waiting = await phone.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "Sent on resume",
    });
    await after(phone, 120_000);
    expect(pulls(cell, "phone")).toBe(pulled + 2);
    expect(cell.item(waiting.id)).toBeNull();

    phone.replica.resume();
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 3);
    expect(cell.item(waiting.id)).not.toBeNull();
    await after(phone, 60_000);
    expect(pulls(cell, "phone")).toBe(pulled + 4);
    await phone.replica.close();
  });

  it("tries a failed pass again after a second, doubling to a minute, and from a second once one passes", async () => {
    const cell = createFakeCell();
    const network = countedNetwork(cell, "phone");
    const recording = recordingClock();
    const phone = await openDevice(cell, "phone", {
      clock: recording.clock,
      network: network.device,
    });
    network.device.setOffline(true);
    phone.replica.start();
    await idle(phone);
    expect(phone.replica.status().failure?.kind).toBe("unreachable");
    expect(network.fetches()).toBe(1);

    await after(phone, 999);
    expect(network.fetches()).toBe(1);
    await after(phone, 1);
    expect(network.fetches()).toBe(2);
    await after(phone, 1999);
    expect(network.fetches()).toBe(2);
    await after(phone, 1);
    expect(network.fetches()).toBe(3);
    for (const [wait, fetched] of [
      [4000, 4],
      [8000, 5],
      [16_000, 6],
      // the minute's check-in comes before the next try is due
      [29_000, 7],
      [60_000, 8],
    ] as const) {
      await after(phone, wait);
      expect(network.fetches()).toBe(fetched);
    }
    // the check-in, then each try's wait, the check-in's minute and the capped try at once
    expect(recording.asked).toEqual([
      60_000, 1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000,
    ]);

    network.device.setOffline(false);
    await after(phone, 60_000);
    expect(phone.replica.status().failure).toBeNull();
    recording.asked.splice(0);
    network.device.setOffline(true);
    await phone.replica.sync();
    expect(recording.asked).toEqual([1000]);
    await phone.replica.close();
  });

  it("syncs as the socket opens, on a frame past the cursor and on a thread's stored event", async () => {
    const cell = createFakeCell();
    const { dial, sockets } = fakeSockets();
    const phone = await openDevice(cell, "phone", { dial });
    const mac = await openDevice(cell, "mac");
    phone.replica.start();
    await idle(phone);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    const [socket] = sockets;
    expect(socket?.url).toBe("wss://cell.test/v1/socket?ticket=a-ticket");
    const pulled = pulls(cell, "phone");

    socket?.open();
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 1);

    socket?.message(JSON.stringify({ head: phone.replica.status().cursor, type: "library" }));
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 1);
    const made = await mac.replica.createNote({
      blocks: [],
      folderId: null,
      tags: [],
      title: "From the Mac",
    });
    await mac.replica.sync();
    socket?.message(JSON.stringify({ head: cell.head(), type: "library" }));
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 2);
    expect(phone.replica.row(made.id)?.title).toBe("From the Mac");

    const frames: unknown[] = [];
    phone.replica.onThreadFrame((frame) => {
      frames.push(frame);
    });
    const thread = { event: { type: "agent.message" }, threadId: THREAD, type: "thread" };
    socket?.message(JSON.stringify({ ...thread, preview: true }));
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 2);
    socket?.message(JSON.stringify({ ...thread, preview: false }));
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 3);
    expect(frames).toHaveLength(2);

    phone.replica.suspend();
    expect(socket?.closed).toBe(true);
    expect(phone.clock.pending()).toBe(0);
    await after(phone, 120_000);
    expect(pulls(cell, "phone")).toBe(pulled + 3);
    phone.replica.resume();
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 4);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    await phone.replica.close();
  });

  it("stops on a session's end, the minute's check-in with it, until it is started again", async () => {
    const cell = createFakeCell();
    const { dial, sockets } = fakeSockets();
    const phone = await openDevice(cell, "phone", { dial });
    phone.replica.start();
    await idle(phone);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    cell.signOut();
    await after(phone, 60_000);
    expect(phone.replica.status().failure).toEqual({ end: "signed-out", kind: "session" });
    expect(sockets[0]?.closed).toBe(true);

    const pulled = pulls(cell, "phone");
    await after(phone, 60_000);
    await after(phone, 60_000);
    expect(pulls(cell, "phone")).toBe(pulled);

    phone.replica.start();
    await idle(phone);
    expect(pulls(cell, "phone")).toBe(pulled + 1);
    await phone.replica.close();
  });
});
