import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientMessageSchema } from "@repo/contract/local/notifications";
import type {
  ChangedMessage,
  ClientMessage,
  RealtimeSubscriptionTarget,
} from "@repo/contract/local/notifications";
import { InvalidationClient } from "../invalidation-client";
import type { InvalidationSocket } from "../invalidation-client";

/** A frame as it arrives off the wire: this client's own vocabulary, plus
 *  whatever a newer server sends that it does not yet understand. */
interface WireFrame {
  type: string;
  entity?: string;
  version?: string;
  changes?: string[];
}

class FakeSocket implements InvalidationSocket {
  sent: string[] = [];
  closed = false;
  onOpen: (() => void) | null = null;
  onMessage: ((event: { data: unknown }) => void) | null = null;
  onClose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onOpen?.();
  }

  receive(frame: WireFrame): void {
    this.onMessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.onClose?.();
  }

  sentFrames(): ClientMessage[] {
    return this.sent.map((raw) => clientMessageSchema.parse(JSON.parse(raw)));
  }
}

const harness = (targets: readonly RealtimeSubscriptionTarget[] = []) => {
  const sockets: FakeSocket[] = [];
  const changed: ChangedMessage[] = [];
  const onReconnected = vi.fn<() => void>();
  const client = new InvalidationClient({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onChanged: (message) => {
      changed.push(message);
    },
    onReconnected,
    targets,
  });
  return { changed, client, onReconnected, sockets };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscriptions", () => {
  it("sends the subscribe frame once the socket is open", () => {
    const h = harness([{ kind: "vault" }]);
    h.client.start();
    const [socket] = h.sockets;
    expect(socket).toBeDefined();
    expect(socket?.sent).toEqual([]);
    socket?.open();
    expect(socket?.sentFrames()).toEqual([{ target: { kind: "vault" }, type: "subscribe" }]);
  });
});

describe("messages", () => {
  it("delivers changed messages and ignores the hello ack", () => {
    const h = harness();
    h.client.start();
    const [socket] = h.sockets;
    socket?.open();
    socket?.receive({ type: "hello" });
    socket?.receive({ changes: ["files-changed"], entity: "vault", type: "changed" });
    expect(h.changed).toEqual([{ changes: ["files-changed"], entity: "vault", type: "changed" }]);
  });

  it("tolerates unknown change kinds from a newer server", () => {
    const h = harness();
    h.client.start();
    const [socket] = h.sockets;
    socket?.open();
    socket?.receive({
      changes: ["files-changed", "brand-new-kind"],
      entity: "vault",
      type: "changed",
    });
    expect(h.changed).toEqual([{ changes: ["files-changed"], entity: "vault", type: "changed" }]);
  });

  it("drops undecodable frames without dying", () => {
    const h = harness();
    h.client.start();
    const [socket] = h.sockets;
    socket?.open();
    socket?.onMessage?.({ data: "not json" });
    socket?.receive({ type: "mystery" });
    expect(h.changed).toEqual([]);
  });
});

describe("reconnect", () => {
  it("reconnects after a drop and resubscribes every target", async () => {
    const h = harness([{ kind: "vault" }, { kind: "thread-list" }]);
    h.client.start();
    const [first] = h.sockets;
    first?.open();
    expect(first?.sent).toHaveLength(2);

    first?.drop();
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(2);

    const [, second] = h.sockets;
    second?.open();
    expect(second?.sentFrames()).toEqual([
      { target: { kind: "vault" }, type: "subscribe" },
      { target: { kind: "thread-list" }, type: "subscribe" },
    ]);
  });

  it("backs off between failed attempts and resets after a successful open", async () => {
    const h = harness();
    h.client.start();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(3);

    h.sockets[2]?.open();
    h.sockets[2]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(4);
  });

  it("reports a reconnect — and never the first connect", async () => {
    const h = harness([{ kind: "vault" }]);
    h.client.start();
    h.sockets[0]?.open();
    expect(h.onReconnected).not.toHaveBeenCalled();

    h.sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    h.sockets[1]?.open();
    expect(h.onReconnected).toHaveBeenCalledTimes(1);

    h.sockets[1]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    h.sockets[2]?.open();
    expect(h.onReconnected).toHaveBeenCalledTimes(2);
  });

  it("stops reconnecting after dispose", async () => {
    const h = harness();
    h.client.start();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();
    h.client.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it("closes the live socket on dispose", () => {
    const h = harness();
    h.client.start();
    h.sockets[0]?.open();
    h.client.dispose();
    expect(h.sockets[0]?.closed).toBe(true);
  });
});
