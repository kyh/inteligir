import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCloudSocketArgs } from "../cloud-client";
import { createCloudSocketOpener } from "../sync/cloud-socket";
import type { DialledSocket } from "../sync/cloud-socket";
import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  SYNC_WS_REVOKED_CLOSE_CODE,
} from "../sync/sync-ws";
import type { SocketListener, SyncPing } from "../sync/sync-ws";

const TEN_MINUTES_MS = 10 * 60_000;

interface StubEvent {
  data?: unknown;
  code?: number | undefined;
}

// a platform socket as the dial hands it over: listeners, send and close, driven from the test.
class StubSocket implements DialledSocket {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly sent: string[] = [];
  closes = 0;
  readonly #listeners = new Map<string, ((event: StubEvent) => void)[]>();

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  addEventListener = (type: string, listener: (event: StubEvent) => void): void => {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  };

  send = (data: string): void => {
    this.sent.push(data);
  };

  close = (): void => {
    this.closes += 1;
  };

  #emit(type: string, event: StubEvent): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  open(): void {
    this.#emit("open", {});
  }

  receive(data: string | Uint8Array): void {
    this.#emit("message", { data });
  }

  closedByPeer(code: number): void {
    this.#emit("close", { code });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

const TAKES_PHONE_REQUESTS: SocketListener = { phoneRequests: true, platform: "desktop" };

const dial = (listener: SocketListener = TAKES_PHONE_REQUESTS) => {
  vi.useFakeTimers();
  const dialled: StubSocket[] = [];
  const closes: number[] = [];
  const pings: SyncPing[] = [];
  const open = createCloudSocketOpener((url, headers) => {
    const socket = new StubSocket(url, headers);
    dialled.push(socket);
    return socket;
  });
  const args: OpenCloudSocketArgs = {
    baseUrl: "https://cloud.test",
    credential: "igd_test",
    listener,
    onClose: (code) => {
      closes.push(code);
    },
    onOpen: () => {},
    onPing: (ping) => {
      pings.push(ping);
    },
  };
  const handle = open(args);
  const [socket] = dialled;
  if (socket === undefined) {
    throw new Error("expected the opener to dial a socket");
  }
  return { closes, handle, pings, socket };
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

describe("the cloud socket's dial", () => {
  it("carries the bearer as a header and says what listens on the upgrade", () => {
    const { socket } = dial();
    const url = new URL(socket.url);

    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://cloud.test/v1/sync/ws");
    expect(url.searchParams.get("platform")).toBe("desktop");
    expect(url.searchParams.get("phoneRequests")).toBe("on");
    expect(socket.headers).toEqual({ authorization: "Bearer igd_test" });
  });

  it("says nothing of phone requests for a Mac that takes none, or for the phone", () => {
    for (const listener of [
      { phoneRequests: false, platform: "desktop" },
      { platform: "mobile" },
    ] satisfies SocketListener[]) {
      const url = new URL(dial(listener).socket.url);
      expect(url.searchParams.get("platform")).toBe(listener.platform);
      expect(url.searchParams.has("phoneRequests")).toBe(false);
    }
  });

  it("hands on a ping frame, and drops the pong and anything it cannot read", () => {
    const { pings, socket } = dial();
    socket.open();
    socket.receive(SYNC_WS_KEEPALIVE_PONG);
    socket.receive(JSON.stringify({ type: "future" }));
    socket.receive(new Uint8Array([1]));
    socket.receive(JSON.stringify({ seq: 4, type: "sync" }));

    expect(pings).toEqual([{ seq: 4, type: "sync" }]);
  });
});

describe("the cloud socket's keepalive", () => {
  it("stays up while every ping is answered", () => {
    const { closes, socket } = dial();
    socket.open();
    answerPings(socket, TEN_MINUTES_MS);

    expect(socket.sent.length).toBeGreaterThan(1);
    expect(socket.sent.every((frame) => frame === SYNC_WS_KEEPALIVE_PING)).toBe(true);
    expect(closes).toEqual([]);
    expect(socket.closes).toBe(0);
  });

  it("drops a socket that stops answering, once, and never as a revocation", () => {
    const { closes, socket } = dial();
    socket.open();
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
    socket.open();
    handle.close();
    socket.closedByPeer(1000);
    vi.advanceTimersByTime(TEN_MINUTES_MS);

    expect(closes).toEqual([]);
    expect(socket.sent).toEqual([]);
  });
});
