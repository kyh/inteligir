import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChangedMessage,
  RealtimeSubscriptionTarget,
} from "@repo/server-contract/notifications";
import { InvalidationClient, type InvalidationSocket } from "../invalidation-client";

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

  receive(frame: unknown): void {
    this.onMessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.onClose?.();
  }

  sentFrames(): unknown[] {
    return this.sent.map((raw): unknown => JSON.parse(raw));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const changed: ChangedMessage[] = [];
  const reconnected: Array<readonly RealtimeSubscriptionTarget[]> = [];
  const client = new InvalidationClient({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onChanged: (message) => changed.push(message),
    onReconnected: (targets) => reconnected.push(targets),
  });
  return { client, sockets, changed, reconnected };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscriptions", () => {
  it("sends the subscribe frame once the socket is open", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    h.client.subscribe({ kind: "vault" });
    expect(socket?.sent).toEqual([]);
    socket?.open();
    expect(socket?.sentFrames()).toEqual([{ type: "subscribe", target: { kind: "vault" } }]);
  });

  it("subscribes immediately when already connected", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    h.client.subscribe({ kind: "doc-detail", docId: "notes/a.md" });
    expect(socket?.sentFrames()).toEqual([
      { type: "subscribe", target: { kind: "doc-detail", docId: "notes/a.md" } },
    ]);
  });

  it("ref-counts a target: one subscribe, unsubscribe only on the last release", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    const releaseA = h.client.subscribe({ kind: "vault" });
    const releaseB = h.client.subscribe({ kind: "vault" });
    expect(socket?.sent).toHaveLength(1);
    releaseA();
    expect(socket?.sent).toHaveLength(1);
    releaseB();
    expect(socket?.sentFrames().at(-1)).toEqual({
      type: "unsubscribe",
      target: { kind: "vault" },
    });
  });

  it("a release is idempotent", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    const release = h.client.subscribe({ kind: "vault" });
    h.client.subscribe({ kind: "vault" });
    release();
    release();
    const unsubscribes = socket
      ?.sentFrames()
      .filter(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "type" in frame &&
          frame.type === "unsubscribe",
      );
    expect(unsubscribes).toEqual([]);
  });
});

describe("messages", () => {
  it("delivers changed messages and ignores the hello ack", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    socket?.receive({ type: "hello", version: "0.1.0" });
    socket?.receive({ type: "changed", entity: "vault", changes: ["files-changed"] });
    expect(h.changed).toEqual([{ type: "changed", entity: "vault", changes: ["files-changed"] }]);
  });

  it("tolerates unknown change kinds from a newer server", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    socket?.receive({
      type: "changed",
      entity: "vault",
      changes: ["files-changed", "brand-new-kind"],
    });
    expect(h.changed).toEqual([{ type: "changed", entity: "vault", changes: ["files-changed"] }]);
  });

  it("drops undecodable frames without dying", () => {
    const h = harness();
    h.client.start();
    const socket = h.sockets[0];
    socket?.open();
    socket?.onMessage?.({ data: "not json" });
    socket?.receive({ type: "mystery" });
    expect(h.changed).toEqual([]);
  });
});

describe("reconnect", () => {
  it("reconnects after a drop and resubscribes every held target", async () => {
    const h = harness();
    h.client.start();
    h.client.subscribe({ kind: "vault" });
    h.client.subscribe({ kind: "doc-detail", docId: "a.md" });
    const first = h.sockets[0];
    first?.open();
    expect(first?.sent).toHaveLength(2);

    first?.drop();
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sockets).toHaveLength(2);

    const second = h.sockets[1];
    second?.open();
    expect(second?.sentFrames()).toEqual([
      { type: "subscribe", target: { kind: "vault" } },
      { type: "subscribe", target: { kind: "doc-detail", docId: "a.md" } },
    ]);
  });

  it("does not resubscribe targets released while disconnected", async () => {
    const h = harness();
    h.client.start();
    const release = h.client.subscribe({ kind: "vault" });
    h.sockets[0]?.open();
    h.sockets[0]?.drop();
    release();
    await vi.advanceTimersByTimeAsync(500);
    const second = h.sockets[1];
    second?.open();
    expect(second?.sent).toEqual([]);
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

  it("reports a reconnect with the held targets — and never the first connect", async () => {
    const h = harness();
    h.client.start();
    h.client.subscribe({ kind: "vault" });
    h.sockets[0]?.open();
    expect(h.reconnected).toEqual([]);

    h.sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    h.sockets[1]?.open();
    expect(h.reconnected).toEqual([[{ kind: "vault" }]]);

    h.sockets[1]?.drop();
    await vi.advanceTimersByTimeAsync(500);
    h.sockets[2]?.open();
    expect(h.reconnected).toHaveLength(2);
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
