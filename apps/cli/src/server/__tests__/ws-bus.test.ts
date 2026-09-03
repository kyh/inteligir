import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  serverMessageLenientSchema,
  serverMessageSchema,
  type ServerMessage,
} from "@repo/api/local/notifications";
import { WsBus, type BusSocket } from "../ws-bus";

interface FakeSocket extends BusSocket {
  closed: { code: number | undefined; reason: string | undefined } | null;
  sent: string[];
}

function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    closed: null,
    readyState: 1,
    sent: [],
    close(code?: number, reason?: string) {
      socket.closed = { code, reason };
    },
    send(data: string) {
      socket.sent.push(data);
    },
  };
  return socket;
}

function createBus(): WsBus {
  return new WsBus();
}

function lastFrame(socket: FakeSocket): ServerMessage {
  const raw = socket.sent.at(-1);
  if (raw === undefined) {
    throw new Error("socket received no frames");
  }
  return serverMessageLenientSchema.parse(JSON.parse(raw));
}

describe("registerClient", () => {
  it("acks with the hello frame", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    expect(lastFrame(socket)).toEqual({ type: "hello" });
  });
});

describe("subscribe/broadcast", () => {
  it("routes a doc change to the vault subscribers and not the thread-list ones", () => {
    const bus = createBus();
    const vaultSocket = createFakeSocket();
    const threadSocket = createFakeSocket();
    for (const socket of [vaultSocket, threadSocket]) {
      bus.registerClient(socket);
    }
    bus.subscribe(vaultSocket, { kind: "vault" });
    bus.subscribe(threadSocket, { kind: "thread-list" });

    bus.notifyDoc("d1", ["content-changed"]);

    expect(lastFrame(vaultSocket)).toEqual({
      type: "changed",
      entity: "doc",
      id: "d1",
      changes: ["content-changed"],
    });
    expect(threadSocket.sent).toHaveLength(1);
  });

  it("delivers each message once to a socket holding both targets", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });
    bus.subscribe(socket, { kind: "thread-list" });

    bus.notifyThread("t1", ["events-appended"]);
    bus.notifyDoc("d1", ["content-changed"]);
    expect(socket.sent).toHaveLength(3);
  });

  it("skips sockets that are no longer open", () => {
    const bus = createBus();
    const open = createFakeSocket();
    const closing = createFakeSocket();
    bus.registerClient(open);
    bus.registerClient(closing);
    bus.subscribe(open, { kind: "vault" });
    bus.subscribe(closing, { kind: "vault" });
    closing.readyState = 2;

    bus.notifyVault(["files-changed"]);
    expect(open.sent).toHaveLength(2);
    expect(closing.sent).toHaveLength(1);
  });

  it("stops delivering after unsubscribe and after unregister", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });

    bus.notifyVault(["files-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.unsubscribe(socket, { kind: "vault" });
    bus.notifyVault(["files-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.subscribe(socket, { kind: "vault" });
    bus.unregisterClient(socket);
    bus.notifyVault(["files-changed"]);
    expect(socket.sent).toHaveLength(2);
  });
});

describe("handleMessage", () => {
  it("subscribes and unsubscribes via the wire protocol", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);

    bus.handleMessage(socket, JSON.stringify({ type: "subscribe", target: { kind: "vault" } }));
    bus.notifyVault(["files-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.handleMessage(socket, JSON.stringify({ type: "unsubscribe", target: { kind: "vault" } }));
    bus.notifyVault(["files-changed"]);
    expect(socket.sent).toHaveLength(2);
    expect(socket.closed).toBeNull();
  });

  it("decodes binary frames", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "subscribe", target: { kind: "vault" } }),
    );
    bus.handleMessage(socket, payload);
    bus.notifyVault(["files-changed"]);
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
      JSON.stringify({ type: "subscribe", target: { kind: "nope" } }),
    );
    expect(unknownTarget.closed).toEqual({
      code: 1008,
      reason: "invalid-message",
    });

    const extraField = createFakeSocket();
    bus.registerClient(extraField);
    bus.handleMessage(
      extraField,
      JSON.stringify({ type: "subscribe", target: { kind: "vault" }, extra: 1 }),
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
    bus.subscribe(socket, { kind: "vault" });
    bus.subscribe(socket, { kind: "thread-list" });
    bus.notifyVault(["files-changed"]);
    bus.notifyVault(["files-changed"], ["notes/a.md"]);
    bus.notifyDoc("d1", ["content-changed"]);
    bus.notifyThread("t1", ["thread-created"]);

    expect(socket.sent.length).toBe(5);
    for (const raw of socket.sent) {
      const frame: unknown = JSON.parse(raw);
      expect(() => serverMessageSchema.parse(frame)).not.toThrow();
      expect(() => serverMessageLenientSchema.parse(frame)).not.toThrow();
    }
  });

  it("a files-changed frame carries the paths it names, and omits the field when it names none", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "vault" });
    bus.notifyVault(["files-changed"], ["notes/a.md", "notes/b.md"]);
    bus.notifyVault(["files-changed"]);

    const [, named, unnamed] = socket.sent;
    expect(JSON.parse(named ?? "null")).toEqual({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
      paths: ["notes/a.md", "notes/b.md"],
    });
    expect(JSON.parse(unnamed ?? "null")).toEqual({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
    });
  });

  it("a future server's extra kinds would be filtered, not fatal", () => {
    const futureFrame = {
      type: "changed",
      entity: "vault",
      changes: ["files-changed", "kind-from-the-future"],
      metadata: { newField: 1 },
    };
    const parsed = changedMessageLenientSchema.parse(futureFrame);
    expect(parsed).toEqual({
      type: "changed",
      entity: "vault",
      changes: ["files-changed"],
    });
  });
});

describe("closing the bus down", () => {
  it("sends every registered client a going-away frame", () => {
    const bus = createBus();
    const first = createFakeSocket();
    const second = createFakeSocket();
    bus.registerClient(first);
    bus.registerClient(second);
    bus.subscribe(second, { kind: "vault" });

    bus.closeAllClients();

    expect(first.closed).toEqual({ code: 1001, reason: "server-shutting-down" });
    expect(second.closed).toEqual({ code: 1001, reason: "server-shutting-down" });
  });

  it("closes a client that never subscribed to anything", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.closeAllClients();
    expect(socket.closed?.code).toBe(1001);
  });

  it("does not close a client that already went away", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.unregisterClient(socket);
    bus.closeAllClients();
    expect(socket.closed).toBeNull();
  });

  it("survives a close() that throws — the terminate pass is the backstop", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    socket.close = () => {
      throw new Error("already closing");
    };
    bus.registerClient(socket);
    expect(() => bus.closeAllClients()).not.toThrow();
  });

  it("terminates the transport of a client that ignored its close frame", () => {
    const bus = createBus();
    let terminated = 0;
    const socket: BusSocket = {
      readyState: 1,
      close: () => {},
      send: () => {},
      raw: {
        terminate: () => {
          terminated += 1;
        },
      },
    };
    bus.registerClient(socket);
    bus.terminateAllClients();
    expect(terminated).toBe(1);
  });

  it("tolerates a socket with no raw transport at all", () => {
    const bus = createBus();
    bus.registerClient(createFakeSocket());
    expect(() => bus.terminateAllClients()).not.toThrow();
  });
});
