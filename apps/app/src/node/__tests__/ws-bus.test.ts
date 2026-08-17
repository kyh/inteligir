import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  serverMessageLenientSchema,
  serverMessageSchema,
} from "@repo/server-contract/notifications";
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
  return new WsBus({ version: "0.1.0-test" });
}

function lastFrame(socket: FakeSocket): unknown {
  const raw = socket.sent.at(-1);
  if (raw === undefined) {
    throw new Error("socket received no frames");
  }
  return JSON.parse(raw);
}

describe("registerClient", () => {
  it("acks with the hello frame", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    expect(lastFrame(socket)).toEqual({ type: "hello", version: "0.1.0-test" });
  });
});

describe("subscribe/broadcast", () => {
  it("fans a doc change out to its detail subscribers and the vault list", () => {
    const bus = createBus();
    const vaultSocket = createFakeSocket();
    const docSocket = createFakeSocket();
    const otherDocSocket = createFakeSocket();
    for (const socket of [vaultSocket, docSocket, otherDocSocket]) {
      bus.registerClient(socket);
    }
    bus.subscribe(vaultSocket, { kind: "vault" });
    bus.subscribe(docSocket, { kind: "doc-detail", docId: "d1" });
    bus.subscribe(otherDocSocket, { kind: "doc-detail", docId: "d2" });

    bus.notifyDoc("d1", ["content-changed"]);

    const expected = {
      type: "changed",
      entity: "doc",
      id: "d1",
      changes: ["content-changed"],
    };
    expect(lastFrame(vaultSocket)).toEqual(expected);
    expect(lastFrame(docSocket)).toEqual(expected);
    // The hello ack is the only frame the other doc's subscriber ever saw.
    expect(otherDocSocket.sent).toHaveLength(1);
  });

  it("delivers a message once to a socket subscribed to both matching targets", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "thread-list" });
    bus.subscribe(socket, { kind: "thread-detail", threadId: "t1" });

    bus.notifyThread("t1", ["events-appended"]);
    expect(socket.sent).toHaveLength(2);
  });

  it("skips sockets that are no longer open", () => {
    const bus = createBus();
    const open = createFakeSocket();
    const closing = createFakeSocket();
    bus.registerClient(open);
    bus.registerClient(closing);
    bus.subscribe(open, { kind: "system" });
    bus.subscribe(closing, { kind: "system" });
    closing.readyState = 2;

    bus.notifySystem(["config-changed"]);
    expect(open.sent).toHaveLength(2);
    expect(closing.sent).toHaveLength(1);
  });

  it("stops delivering after unsubscribe and after unregister", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "system" });

    bus.notifySystem(["config-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.unsubscribe(socket, { kind: "system" });
    bus.notifySystem(["config-changed"]);
    expect(socket.sent).toHaveLength(2);

    bus.subscribe(socket, { kind: "system" });
    bus.unregisterClient(socket);
    bus.notifySystem(["config-changed"]);
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
      JSON.stringify({ type: "subscribe", target: { kind: "system" } }),
    );
    bus.handleMessage(socket, payload);
    bus.notifySystem(["config-changed"]);
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
      JSON.stringify({ type: "subscribe", target: { kind: "system" }, extra: 1 }),
    );
    expect(extraField.closed).toEqual({
      code: 1008,
      reason: "invalid-message",
    });
  });
});

describe("outbound frames against the contract schemas", () => {
  // The bus serializes house-constructed frames without a per-send parse, so
  // this is where the shape stays loud: every frame the bus can emit must
  // parse under the STRICT schemas (and therefore the lenient ones).
  it("every emittable frame parses strictly, hello included", () => {
    const bus = createBus();
    const socket = createFakeSocket();
    bus.registerClient(socket);
    bus.subscribe(socket, { kind: "system" });
    bus.subscribe(socket, { kind: "vault" });
    bus.subscribe(socket, { kind: "thread-list" });
    bus.notifySystem(["config-changed"]);
    bus.notifyVault(["files-changed"]);
    bus.notifyVault(["files-changed"], ["notes/a.md"]);
    bus.notifyDoc("d1", ["content-changed"]);
    bus.notifyThread("t1", ["thread-created"]);

    expect(socket.sent.length).toBe(6);
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
    // Absent, never `paths: []` — an empty list would read as "nothing moved".
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
