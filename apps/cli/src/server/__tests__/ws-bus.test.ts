import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  serverMessageLenientSchema,
  serverMessageSchema,
} from "@repo/contract/local/notifications";
import type { ServerMessage } from "@repo/contract/local/notifications";
import { WsBus } from "../ws-bus";
import type { BusSocket } from "../ws-bus";

interface FakeSocket extends BusSocket {
  closed: { code: number | undefined; reason: string | undefined } | null;
  sent: string[];
}

const createFakeSocket = (): FakeSocket => {
  const socket: FakeSocket = {
    close(code?: number, reason?: string) {
      socket.closed = { code, reason };
    },
    closed: null,
    readyState: 1,
    send(data: string) {
      socket.sent.push(data);
    },
    sent: [],
  };
  return socket;
};

const createBus = (): WsBus => new WsBus();

const lastFrame = (socket: FakeSocket): ServerMessage => {
  const raw = socket.sent.at(-1);
  if (raw === undefined) {
    throw new Error("socket received no frames");
  }
  return serverMessageLenientSchema.parse(JSON.parse(raw));
};

describe("registerClient", () => {
  it("acks with the hello frame", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    expect(lastFrame(socket)).toEqual({ type: "hello" });
  });
});

describe("subscribe/broadcast", () => {
  it("routes a sync status change to the sync subscribers and not the thread-list ones", () => {
    const bus = createBus();
    const syncSocket = createFakeSocket();
    const threadSocket = createFakeSocket();
    for (const socket of [syncSocket, threadSocket]) {
      bus.registerClient(socket);
    }
    bus.subscribe(syncSocket, { kind: "sync" });
    bus.subscribe(threadSocket, { kind: "thread-list" });

    bus.notifySync(["sync-status-changed"]);

    expect(lastFrame(syncSocket)).toEqual({
      changes: ["sync-status-changed"],
      entity: "sync",
      type: "changed",
    });
    expect(threadSocket.sent).toHaveLength(1);
  });

  it("delivers each message once to a socket holding both targets", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "sync" });
    bus.subscribe(socket, { kind: "thread-list" });

    bus.notifyThread("t1", ["events-appended"]);
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(3);
  });

  it("skips sockets that are no longer open", () => {
    const bus = createBus();
    const open = createFakeSocket();
    const closing = createFakeSocket();
    bus.registerClient(open);
    bus.registerClient(closing);
    bus.subscribe(open, { kind: "sync" });
    bus.subscribe(closing, { kind: "sync" });
    closing.readyState = 2;

    bus.notifySync(["sync-status-changed"]);
    expect(open.sent).toHaveLength(2);
    expect(closing.sent).toHaveLength(1);
  });

  it("stops delivering after unsubscribe and after unregister", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "sync" });

    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.unsubscribe(socket, { kind: "sync" });
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.subscribe(socket, { kind: "sync" });
    bus.unregisterClient(socket);
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);
  });
});

describe("an in-process listener", () => {
  it("hears every thread change, whether or not a socket is subscribed", () => {
    const bus = createBus();
    const heard: string[] = [];
    bus.onThreadChange((threadId, changes) => {
      heard.push(`${threadId} ${changes.join(",")}`);
    });

    bus.notifyThread("thr_1", ["interactions-changed"]);
    bus.notifySync(["sync-status-changed"]);

    expect(heard).toEqual(["thr_1 interactions-changed"]);
  });
});

describe("handleMessage", () => {
  it("subscribes and unsubscribes via the wire protocol", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);

    bus.handleMessage(socket, JSON.stringify({ target: { kind: "sync" }, type: "subscribe" }));
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.handleMessage(socket, JSON.stringify({ target: { kind: "sync" }, type: "unsubscribe" }));
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);
    expect(socket.closed).toBeNull();
  });

  it("decodes binary frames", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    const payload = new TextEncoder().encode(
      JSON.stringify({ target: { kind: "sync" }, type: "subscribe" }),
    );
    bus.handleMessage(socket, payload);
    bus.notifySync(["sync-status-changed"]);
    expect(socket.sent).toHaveLength(2);
  });

  it("closes the socket on malformed JSON and on schema violations", () => {
    const bus = createBus();
    const malformed = createFakeSocket();
    bus.registerClient(malformed);
    bus.handleMessage(malformed, "not json");
    expect(malformed.closed).toEqual({ code: 1008, reason: "invalid-message" });

    const unknownTarget = createFakeSocket();
    bus.registerClient(unknownTarget);
    bus.handleMessage(
      unknownTarget,
      JSON.stringify({ target: { kind: "nope" }, type: "subscribe" }),
    );
    expect(unknownTarget.closed).toEqual({
      code: 1008,
      reason: "invalid-message",
    });

    const extraField = createFakeSocket();
    bus.registerClient(extraField);
    bus.handleMessage(
      extraField,
      JSON.stringify({ extra: 1, target: { kind: "sync" }, type: "subscribe" }),
    );
    expect(extraField.closed).toEqual({
      code: 1008,
      reason: "invalid-message",
    });
  });
});

describe("outbound frames against the contract schemas", () => {
  it("every emittable frame parses strictly, hello included", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "sync" });
    bus.subscribe(socket, { kind: "thread-list" });
    bus.notifySync(["sync-status-changed"]);
    bus.notifyThread("t1", ["thread-created"]);

    expect(socket.sent.length).toBe(3);
    for (const raw of socket.sent) {
      const frame: unknown = JSON.parse(raw);
      expect(() => serverMessageSchema.parse(frame)).not.toThrow();
      expect(() => serverMessageLenientSchema.parse(frame)).not.toThrow();
    }
  });

  it("a future server's extra kinds would be filtered, not fatal", () => {
    const futureFrame = {
      changes: ["sync-status-changed", "kind-from-the-future"],
      entity: "sync",
      metadata: { newField: 1 },
      type: "changed",
    };
    const parsed = changedMessageLenientSchema.parse(futureFrame);
    expect(parsed).toEqual({
      changes: ["sync-status-changed"],
      entity: "sync",
      type: "changed",
    });
  });
});
