import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWsBridge } from "@repo/bridge/ws-bridge";
import { encodeFrame, parseClientFrame } from "@repo/bridge/ws-protocol";
import {
  createHostConnection,
  shouldReuseSocket,
  SOCKET_REUSE_WINDOW_MS,
  type HostSnapshot,
} from "../connection-core";
import type { KnownEnvironment } from "../environment-store";
import { fakeWebSocketImpl, lastSocket, type FakeSocket } from "./fakes";

const ENV: KnownEnvironment = {
  name: "192.168.1.5",
  wsUrl: "ws://192.168.1.5:47890",
  deviceId: "d1",
  deviceToken: "durable-token",
};

function fakeLifecycle() {
  const listeners = new Set<(state: "active" | "background") => void>();
  return {
    port: {
      subscribe: (listener: (state: "active" | "background") => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setState: (state: "active" | "background") => {
      for (const listener of listeners) listener(state);
    },
  };
}

// The owner under test drives the REAL createWsBridge over fake sockets, so
// the statuses it publishes are the bridge's actual transitions. The clock is
// a plain variable the tests advance alongside vitest's fake timers.
function setup() {
  const { impl, sockets } = fakeWebSocketImpl();
  const lifecycle = fakeLifecycle();
  const clock = { now: 1_000 };
  const connection = createHostConnection({
    createBridge: (options) => createWsBridge({ ...options, webSocketImpl: impl }),
    lifecycle: lifecycle.port,
    now: () => clock.now,
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  });
  const statuses: HostSnapshot[] = [];
  connection.subscribe(() => statuses.push(connection.getSnapshot()));
  /** Move the injected clock AND the timers together. */
  const advance = (ms: number) => {
    clock.now += ms;
    vi.advanceTimersByTime(ms);
  };
  return { connection, sockets, lifecycle, statuses, advance };
}

function welcome(socket: FakeSocket): void {
  socket.fireOpen();
  socket.fireMessage(encodeFrame({ t: "welcome" }));
}

describe("shouldReuseSocket", () => {
  const base = { backgroundedAt: 1_000, windowMs: 10_000 } as const;

  it("keeps a still-connected socket backgrounded inside the window", () => {
    expect(shouldReuseSocket({ ...base, now: 6_000, status: "connected" })).toBe(true);
    expect(shouldReuseSocket({ ...base, now: 11_000, status: "connected" })).toBe(true);
  });

  it("rebuilds once the gap passes the window", () => {
    expect(shouldReuseSocket({ ...base, now: 11_001, status: "connected" })).toBe(false);
  });

  it("rebuilds when the socket did not survive the background", () => {
    expect(shouldReuseSocket({ ...base, now: 2_000, status: "disconnected" })).toBe(false);
    expect(shouldReuseSocket({ ...base, now: 2_000, status: "connecting" })).toBe(false);
    expect(shouldReuseSocket({ ...base, now: 2_000, status: "unauthorized" })).toBe(false);
  });

  it("rebuilds when the clock moved backwards (the gap proves nothing)", () => {
    expect(shouldReuseSocket({ ...base, now: 500, status: "connected" })).toBe(false);
  });
});

describe("createHostConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts as none with no bridge", () => {
    const { connection, sockets } = setup();
    expect(connection.getSnapshot()).toEqual({ status: "none", envName: null });
    expect(connection.getBridge()).toBeNull();
    expect(sockets).toHaveLength(0);
    connection.dispose();
  });

  it("start() connects with the stored device token and reaches connected", () => {
    const { connection, sockets } = setup();
    connection.start(ENV);
    expect(connection.getSnapshot()).toEqual({ status: "connecting", envName: "192.168.1.5" });

    const socket = lastSocket(sockets);
    expect(socket.url).toBe(ENV.wsUrl);
    socket.fireOpen();
    const sent = socket.sent[0];
    const frame = typeof sent === "string" ? parseClientFrame(sent) : null;
    expect(frame).toEqual({ t: "auth", token: "durable-token" });

    socket.fireMessage(encodeFrame({ t: "welcome" }));
    expect(connection.getSnapshot().status).toBe("connected");
    expect(connection.getBridge()).not.toBeNull();
    connection.dispose();
  });

  it("close 4401 surfaces unauthorized, nulls the bridge, and keeps the env name", () => {
    const { connection, sockets } = setup();
    connection.start(ENV);
    const socket = lastSocket(sockets);
    welcome(socket);
    socket.fireClose(4401);
    expect(connection.getSnapshot()).toEqual({ status: "unauthorized", envName: "192.168.1.5" });
    expect(connection.getBridge()).toBeNull();
    connection.dispose();
  });

  it("unauthorized is sticky across a foreground resume (no dead-token retry)", () => {
    const { connection, sockets, lifecycle } = setup();
    connection.start(ENV);
    lastSocket(sockets).fireClose(4401);
    const before = sockets.length;

    lifecycle.setState("active");
    expect(sockets).toHaveLength(before);
    expect(connection.getSnapshot().status).toBe("unauthorized");

    // …but an explicit start() (after re-pairing) connects again.
    connection.start(ENV);
    expect(sockets).toHaveLength(before + 1);
    expect(connection.getSnapshot().status).toBe("connecting");
    connection.dispose();
  });

  it("a long background disposes the bridge; foregrounding recreates it", () => {
    const { connection, sockets, lifecycle, advance } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));
    expect(connection.getSnapshot().status).toBe("connected");

    lifecycle.setState("background");
    advance(SOCKET_REUSE_WINDOW_MS + 1);
    expect(connection.getSnapshot()).toEqual({ status: "disconnected", envName: "192.168.1.5" });
    expect(connection.getBridge()).toBeNull();
    expect(lastSocket(sockets).closedWith?.code).toBe(1000);

    lifecycle.setState("active");
    expect(sockets).toHaveLength(2);
    expect(connection.getSnapshot().status).toBe("connecting");
    welcome(lastSocket(sockets));
    expect(connection.getSnapshot().status).toBe("connected");
    connection.dispose();
  });

  it("a brief background keeps the live socket, so nothing in flight is dropped", () => {
    const { connection, sockets, lifecycle, advance } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));
    const bridge = connection.getBridge();

    lifecycle.setState("background");
    advance(1_000);
    expect(lastSocket(sockets).closedWith).toBeNull();

    lifecycle.setState("active");
    advance(SOCKET_REUSE_WINDOW_MS * 2);
    expect(sockets).toHaveLength(1);
    expect(connection.getBridge()).toBe(bridge);
    expect(connection.getSnapshot().status).toBe("connected");
    connection.dispose();
  });

  it("a background that outlived the window is not resurrected by a late resume", () => {
    const { connection, sockets, lifecycle, advance } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));

    lifecycle.setState("background");
    advance(SOCKET_REUSE_WINDOW_MS + 1);
    lifecycle.setState("active");
    expect(sockets).toHaveLength(2);
    connection.dispose();
  });

  it("backgrounding while unauthorized never arms a close that clears it", () => {
    const { connection, sockets, lifecycle, advance } = setup();
    connection.start(ENV);
    lastSocket(sockets).fireClose(4401);

    lifecycle.setState("background");
    advance(SOCKET_REUSE_WINDOW_MS * 2);
    expect(connection.getSnapshot().status).toBe("unauthorized");

    lifecycle.setState("active");
    expect(connection.getSnapshot().status).toBe("unauthorized");
    expect(sockets).toHaveLength(1);
    connection.dispose();
  });

  it("stop() during a background cancels the deferred close", () => {
    const { connection, sockets, lifecycle, advance } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));
    lifecycle.setState("background");
    connection.stop();

    advance(SOCKET_REUSE_WINDOW_MS * 2);
    expect(connection.getSnapshot()).toEqual({ status: "none", envName: null });
    expect(sockets).toHaveLength(1);
    connection.dispose();
  });

  it("lifecycle events are inert while nothing is started", () => {
    const { connection, sockets, lifecycle } = setup();
    lifecycle.setState("background");
    lifecycle.setState("active");
    expect(sockets).toHaveLength(0);
    expect(connection.getSnapshot()).toEqual({ status: "none", envName: null });
    connection.dispose();
  });

  it("a dropped connection is the bridge supervisor's to retry, not a new bridge", () => {
    const { connection, sockets } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));
    lastSocket(sockets).fireClose(1006);
    expect(connection.getSnapshot().status).toBe("disconnected");
    // The supervisor's backoff timer reconnects on the SAME bridge.
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    welcome(lastSocket(sockets));
    expect(connection.getSnapshot().status).toBe("connected");
    connection.dispose();
  });

  it("stop() returns to none and drops the bridge", () => {
    const { connection, sockets, statuses } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));
    connection.stop();
    expect(connection.getSnapshot()).toEqual({ status: "none", envName: null });
    expect(connection.getBridge()).toBeNull();
    // The disposed bridge's final "disconnected" never leaks past the stop.
    expect(statuses[statuses.length - 1]).toEqual({ status: "none", envName: null });
    connection.dispose();
  });

  it("start() over a live connection replaces it without leaking stale statuses", () => {
    const { connection, sockets } = setup();
    connection.start(ENV);
    welcome(lastSocket(sockets));

    const other: KnownEnvironment = { ...ENV, name: "laptop", wsUrl: "ws://10.0.0.2:47890" };
    connection.start(other);
    expect(sockets).toHaveLength(2);
    expect(connection.getSnapshot()).toEqual({ status: "connecting", envName: "laptop" });
    welcome(lastSocket(sockets));
    expect(connection.getSnapshot()).toEqual({ status: "connected", envName: "laptop" });
    connection.dispose();
  });

  it("dispose() unhooks the lifecycle", () => {
    const { connection, sockets, lifecycle } = setup();
    connection.start(ENV);
    connection.dispose();
    lifecycle.setState("active");
    expect(sockets).toHaveLength(1);
  });
});
