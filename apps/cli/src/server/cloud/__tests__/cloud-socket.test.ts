import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  SYNC_WS_REVOKED_CLOSE_CODE,
} from "@repo/api/cloud/sync/sync-ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCloudSocket } from "../cloud-socket";

const TEN_MINUTES_MS = 10 * 60_000;

// the node WebSocket as the dial sees it: listeners, send and close, driven from the test.
class StubSocket extends EventTarget {
  static dialled: StubSocket[] = [];
  readonly sent: string[] = [];
  closes = 0;

  constructor() {
    super();
    StubSocket.dialled.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closes += 1;
  }

  open(): void {
    this.dispatchEvent(new Event("open"));
  }

  receive(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  closedByPeer(code: number): void {
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}

afterEach(() => {
  StubSocket.dialled = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dial = () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", StubSocket);
  const closes: number[] = [];
  const handle = openCloudSocket({
    baseUrl: "https://cloud.test",
    credential: "igd_test",
    onClose: (code) => {
      closes.push(code);
    },
    onOpen: () => {},
    onPing: () => {},
    platform: "desktop",
  });
  const [socket] = StubSocket.dialled;
  if (socket === undefined) {
    throw new Error("expected the dial to construct a socket");
  }
  socket.open();
  return { closes, handle, socket };
};

// a second at a time, answering each ping as the cloud's auto-response would.
const answerPings = (socket: StubSocket, forMs: number): void => {
  for (let elapsed = 0; elapsed < forMs; elapsed += 1000) {
    const sent = socket.sent.length;
    vi.advanceTimersByTime(1000);
    if (socket.sent.length > sent) {
      socket.receive(SYNC_WS_KEEPALIVE_PONG);
    }
  }
};

describe("the cloud socket's keepalive", () => {
  it("stays up while every ping is answered", () => {
    const { closes, socket } = dial();
    answerPings(socket, TEN_MINUTES_MS);

    expect(socket.sent.length).toBeGreaterThan(1);
    expect(socket.sent.every((frame) => frame === SYNC_WS_KEEPALIVE_PING)).toBe(true);
    expect(closes).toEqual([]);
    expect(socket.closes).toBe(0);
  });

  it("drops a socket that stops answering, once, and never as a revocation", () => {
    const { closes, socket } = dial();
    answerPings(socket, 2 * 60_000);

    vi.advanceTimersByTime(TEN_MINUTES_MS);
    // the close event a half-open socket delivers late finds nothing left to report.
    socket.closedByPeer(1006);

    expect(closes).toHaveLength(1);
    expect(closes).not.toContain(SYNC_WS_REVOKED_CLOSE_CODE);
    expect(socket.closes).toBe(1);
  });

  it("reports nothing for a close this side asked for", () => {
    const { closes, handle, socket } = dial();
    handle.close();
    socket.closedByPeer(1000);
    vi.advanceTimersByTime(TEN_MINUTES_MS);

    expect(closes).toEqual([]);
    expect(socket.sent).toEqual([]);
  });
});
