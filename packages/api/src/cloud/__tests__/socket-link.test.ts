import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCloudSocketArgs } from "../cloud-client";
import { createSocketLink } from "../sync/socket-link";
import type { SocketLinkArgs } from "../sync/socket-link";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "../sync/sync-ws";
import type { SocketListener } from "../sync/sync-ws";

afterEach(() => {
  vi.useRealTimers();
});

const harness = (overrides: Partial<SocketLinkArgs> = {}) => {
  vi.useFakeTimers();
  const dials: OpenCloudSocketArgs[] = [];
  const closed: number[] = [];
  const severed: number[] = [];
  const connection: boolean[] = [];
  let listener: SocketListener = { phoneRequests: true, platform: "desktop" };
  const link = createSocketLink({
    baseUrl: "https://cloud.test",
    canConnect: () => true,
    credential: () => "igd_test",
    listener: () => listener,
    onConnectionChanged: (connected) => {
      connection.push(connected);
    },
    onPing: () => {},
    onSevered: () => {
      severed.push(dials.length);
    },
    openSocket: (args) => {
      dials.push(args);
      const index = dials.length - 1;
      return {
        close: () => {
          closed.push(index);
        },
      };
    },
    ...overrides,
  });
  const lastDial = (): OpenCloudSocketArgs => {
    const dial = dials.at(-1);
    if (dial === undefined) {
      throw new Error("expected a dial");
    }
    return dial;
  };
  return {
    closed,
    connection,
    dials,
    lastDial,
    link,
    severed,
    setListener: (next: SocketListener) => {
      listener = next;
    },
  };
};

describe("the socket link", () => {
  it("dials once, and says what listens as it stands at each dial", () => {
    const { dials, link, setListener } = harness();
    link.connect();
    link.connect();
    expect(dials).toHaveLength(1);

    setListener({ phoneRequests: false, platform: "desktop" });
    link.close();
    link.connect();

    expect(dials.map((dial) => dial.listener)).toEqual([
      { phoneRequests: true, platform: "desktop" },
      { phoneRequests: false, platform: "desktop" },
    ]);
  });

  it("dials nothing it may not, and nothing without a credential", () => {
    const refused = harness({ canConnect: () => false });
    refused.link.connect();
    const anonymous = harness({ credential: () => null });
    anonymous.link.connect();

    expect(refused.dials).toEqual([]);
    expect(anonymous.dials).toEqual([]);
  });

  it("dials again after a drop, backing off, and reports the connection both ways", () => {
    const { connection, dials, lastDial, link } = harness();
    link.connect();
    lastDial().onOpen();
    expect(link.isConnected()).toBe(true);

    lastDial().onClose(1006);
    expect(link.isConnected()).toBe(false);
    vi.advanceTimersByTime(999);
    expect(dials).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(dials).toHaveLength(2);

    lastDial().onClose(1006);
    vi.advanceTimersByTime(1999);
    expect(dials).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(dials).toHaveLength(3);
    expect(connection).toEqual([true, false]);
  });

  it("reports a revoked close as severed, and still dials again", () => {
    const { dials, lastDial, link, severed } = harness();
    link.connect();
    lastDial().onClose(SYNC_WS_REVOKED_CLOSE_CODE);
    vi.advanceTimersByTime(1000);

    expect(severed).toEqual([1]);
    expect(dials).toHaveLength(2);
  });

  it("closes for good: no reconnect is left armed, and a late close is not its own", () => {
    const { closed, dials, lastDial, link } = harness();
    link.connect();
    const first = lastDial();
    first.onClose(1006);
    link.close();
    vi.advanceTimersByTime(60_000);
    expect(dials).toHaveLength(1);

    link.connect();
    link.close();
    lastDial().onClose(1000);
    vi.advanceTimersByTime(60_000);

    expect(dials).toHaveLength(2);
    expect(closed).toEqual([1]);
    expect(link.isConnected()).toBe(false);
  });
});
