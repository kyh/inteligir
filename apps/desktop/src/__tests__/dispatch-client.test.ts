// ---------------------------------------------------------------------------
// Dispatch client — the trust-model lifecycle, exercised end to end with a
// fake socket + in-memory store: opt-in default-off, pairing-credential
// persistence (versioned store, legacy migration), presence-gated transcript
// streaming, inbound parse-rejection, and rotate/disable teardown.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type DispatchMessage,
} from "@repo/dispatch/protocol";
import { parsePairingString } from "@repo/dispatch/pairing";
import type { ConnectionConfig } from "@repo/dispatch/room";

import {
  createDispatchClient,
  DISPATCH_STORE_DEFAULT,
  DISPATCH_STORE_VERSIONING,
  DispatchStoreSchema,
  type DispatchInbound,
  type DispatchSocket,
  type DispatchStore,
} from "@/main/dispatch/dispatch-client";
import { JsonStore, type FsAdapter } from "@/main/lib/json-store";
import type { DispatchState } from "@/shared/dispatch";

const STORE_PATH = "/dispatch-room.json";

function memoryFs(): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      files.set(path, content);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
}

/** Superset event the fake stores internally; each overload's listener type
 * is a structural subset, so registration needs no casts. */
type FakeSocketEvent = { data: unknown; code: number; reason: string };

class FakeSocket implements DispatchSocket {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: FakeSocketEvent) => void>>();

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: string, listener: (event: FakeSocketEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }

  private dispatch(type: string, event: FakeSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitOpen(): void {
    this.readyState = 1; // OPEN
    this.dispatch("open", { data: undefined, code: 0, reason: "" });
  }

  emitClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.dispatch("close", { data: undefined, code, reason });
  }

  emitMessage(data: unknown): void {
    this.dispatch("message", { data, code: 0, reason: "" });
  }

  emitFrame(message: DispatchMessage): void {
    this.emitMessage(serializeMessage(message));
  }

  /** Parsed view of everything this socket sent. */
  sentMessages(): DispatchMessage[] {
    return this.sent.map((raw) => {
      const result = parseMessage(raw);
      if (!result.ok) throw new Error(`fake socket sent invalid frame: ${result.error.code}`);
      return result.message;
    });
  }
}

function harness(initialFile?: string) {
  const fs = memoryFs();
  if (initialFile !== undefined) fs.files.set(STORE_PATH, initialFile);
  const store = new JsonStore<DispatchStore>(
    STORE_PATH,
    DispatchStoreSchema,
    DISPATCH_STORE_DEFAULT,
    {
      fs,
      versioning: DISPATCH_STORE_VERSIONING,
    },
  );
  const sockets: FakeSocket[] = [];
  const configs: ConnectionConfig[] = [];
  const states: DispatchState[] = [];
  const inbound: DispatchInbound[] = [];
  const client = createDispatchClient({
    store,
    host: () => "relay.test:8787",
    createSocket: (config) => {
      configs.push(config);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStateChange: (state) => states.push(state),
  });
  const handler = (message: DispatchInbound) => inbound.push(message);
  return { fs, store, sockets, configs, states, inbound, client, handler };
}

function storedFile(fs: { files: Map<string, string> }): DispatchStore {
  const raw = fs.files.get(STORE_PATH);
  expect(raw).toBeDefined();
  return JSON.parse(raw ?? "") as DispatchStore;
}

const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
afterEach(() => {
  consoleWarn.mockClear();
});

describe("opt-in lifecycle", () => {
  it("defaults to off: no socket, no room file, state off", () => {
    const h = harness();
    h.client.init(h.handler);

    expect(h.sockets).toHaveLength(0);
    expect(h.client.getState()).toEqual({ status: "off" });
    // Nothing should have been written to disk just by initializing.
    expect(h.fs.files.has(STORE_PATH)).toBe(false);
  });

  it("migrates a legacy room-code file to disabled (no silent re-enable)", () => {
    // The unversioned era persisted a bare Math.random room code string.
    const h = harness(JSON.stringify("AB12CD"));
    h.client.init(h.handler);

    expect(h.sockets).toHaveLength(0);
    expect(h.client.getState()).toEqual({ status: "off" });
    // The migrated v1 shape is persisted back.
    expect(storedFile(h.fs)).toEqual({ version: 1, enabled: false, credential: null });
  });

  it("enable mints a credential, persists it, and connects as role=desktop", () => {
    const h = harness();
    h.client.init(h.handler);

    const state = h.client.setEnabled(true);

    expect(state.status).toBe("connecting");
    expect(h.sockets).toHaveLength(1);
    const config = h.configs[0];
    expect(config?.host).toBe("relay.test:8787");
    expect(config?.query.role).toBe("desktop");

    const persisted = storedFile(h.fs);
    expect(persisted.enabled).toBe(true);
    expect(persisted.credential).not.toBeNull();
    expect(config?.room).toBe(persisted.credential?.roomId);
    expect(config?.query.token).toBe(persisted.credential?.token);

    // The user-facing pairing string round-trips back to the credential.
    if (state.status !== "connecting") throw new Error("expected connecting state");
    expect(parsePairingString(state.pairing)).toEqual(persisted.credential);
  });

  it("reconnects on init when Remote Access was left enabled", () => {
    const first = harness();
    first.client.init(first.handler);
    first.client.setEnabled(true);
    const file = first.fs.files.get(STORE_PATH);

    const second = harness(file);
    second.client.init(second.handler);

    expect(second.sockets).toHaveLength(1);
    expect(second.client.getState().status).toBe("connecting");
    expect(second.configs[0]?.query.token).toBe(storedFile(second.fs).credential?.token);
  });

  it("disable sends room_teardown, closes the socket, and forgets the credential", () => {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const socket = h.sockets[0];
    if (!socket) throw new Error("expected socket");
    socket.emitOpen();

    const state = h.client.setEnabled(false);

    expect(state).toEqual({ status: "off" });
    expect(socket.sentMessages()).toContainEqual({ v: PROTOCOL_VERSION, type: "room_teardown" });
    expect(socket.closed).toBe(true);
    expect(storedFile(h.fs)).toEqual({ version: 1, enabled: false, credential: null });
  });

  it("rotate tears the old room down and claims a new one with a fresh credential", () => {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const oldCredential = storedFile(h.fs).credential;
    const oldSocket = h.sockets[0];
    if (!oldSocket) throw new Error("expected socket");
    oldSocket.emitOpen();

    const state = h.client.rotateCredential();

    expect(oldSocket.sentMessages()).toContainEqual({ v: PROTOCOL_VERSION, type: "room_teardown" });
    expect(oldSocket.closed).toBe(true);
    expect(h.sockets).toHaveLength(2);

    const newCredential = storedFile(h.fs).credential;
    expect(newCredential).not.toBeNull();
    expect(newCredential?.roomId).not.toBe(oldCredential?.roomId);
    expect(newCredential?.token).not.toBe(oldCredential?.token);
    expect(h.configs[1]?.room).toBe(newCredential?.roomId);
    expect(state.status).toBe("connecting");
  });

  it("a stale socket's late close event cannot clobber the rotated connection", () => {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const oldSocket = h.sockets[0];
    if (!oldSocket) throw new Error("expected socket");
    oldSocket.emitOpen();

    h.client.rotateCredential();
    const newSocket = h.sockets[1];
    if (!newSocket) throw new Error("expected rotated socket");
    newSocket.emitOpen();
    expect(h.client.getState().status).toBe("connected");

    // The old (cancelled) socket's close event arrives after the new socket
    // opened — it must be ignored, not reset the state to connecting.
    oldSocket.emitClose();
    expect(h.client.getState().status).toBe("connected");
  });

  it("rotate is a no-op while disabled", () => {
    const h = harness();
    h.client.init(h.handler);
    expect(h.client.rotateCredential()).toEqual({ status: "off" });
    expect(h.sockets).toHaveLength(0);
  });
});

describe("presence-gated transcript streaming", () => {
  function connected() {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const socket = h.sockets[0];
    if (!socket) throw new Error("expected socket");
    socket.emitOpen();
    socket.sent = []; // ignore anything sent during setup
    return { ...h, socket };
  }

  it("does not stream while no mobile peer is present", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "presence", peers: [] });

    h.client.sendAgentEvent({ type: "agent_start" });

    expect(h.socket.sent).toHaveLength(0);
  });

  it("streams after peer_joined(mobile) and stops after peer_left(mobile)", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "peer_joined", role: "mobile" });

    h.client.sendAgentEvent({ type: "message_update", delta: "hi" });
    expect(h.socket.sentMessages()).toEqual([
      {
        v: PROTOCOL_VERSION,
        type: "agent_event",
        event: { type: "message_update", delta: "hi" },
      },
    ]);

    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "peer_left", role: "mobile" });
    h.socket.sent = [];
    h.client.sendAgentEvent({ type: "agent_end" });
    expect(h.socket.sent).toHaveLength(0);
  });

  it("a presence snapshot listing a mobile peer enables streaming (reconnect path)", () => {
    const h = connected();
    h.socket.emitFrame({
      v: PROTOCOL_VERSION,
      type: "presence",
      peers: [{ role: "mobile" }],
    });

    h.client.sendAgentEvent({ type: "agent_start" });
    expect(h.socket.sent).toHaveLength(1);

    const state = h.client.getState();
    expect(state).toEqual({
      status: "connected",
      pairing: expect.stringContaining("."),
      mobilePresent: true,
    });
  });

  it("socket close resets presence; events stop until the next snapshot", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "peer_joined", role: "mobile" });
    h.socket.emitClose();

    h.client.sendAgentEvent({ type: "agent_start" });
    expect(h.socket.sent).toHaveLength(0);
    expect(h.client.getState().status).toBe("connecting");
  });

  it("never streams while Remote Access is off", () => {
    const h = harness();
    h.client.init(h.handler);
    h.client.sendAgentEvent({ type: "agent_start" });
    expect(h.sockets).toHaveLength(0);
  });

  it("chat_reply needs an open socket but not a mobile peer", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "presence", peers: [] });

    h.client.sendChatReply("corr-1", "done");

    expect(h.socket.sentMessages()).toEqual([
      { v: PROTOCOL_VERSION, type: "chat_reply", correlationId: "corr-1", text: "done" },
    ]);
  });
});

describe("inbound parsing", () => {
  function connected() {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const socket = h.sockets[0];
    if (!socket) throw new Error("expected socket");
    socket.emitOpen();
    return { ...h, socket };
  }

  it("delivers valid commands as typed messages", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "user_message", text: "hello" });
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "steer", text: "left" });
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "interrupt" });
    h.socket.emitFrame({
      v: PROTOCOL_VERSION,
      type: "chat_message",
      correlationId: "c1",
      text: "from slack",
    });

    expect(h.inbound).toEqual([
      { v: 1, type: "user_message", text: "hello" },
      { v: 1, type: "steer", text: "left" },
      { v: 1, type: "interrupt" },
      { v: 1, type: "chat_message", correlationId: "c1", text: "from slack" },
    ]);
  });

  it("rejects malformed frames without reaching the handler", () => {
    const h = connected();

    h.socket.emitMessage("not json");
    h.socket.emitMessage(JSON.stringify({ type: "user_message", text: "no version" }));
    h.socket.emitMessage(JSON.stringify({ v: 999, type: "user_message", text: "bad version" }));
    h.socket.emitMessage(JSON.stringify({ v: 1, type: "nonsense" }));
    h.socket.emitMessage(JSON.stringify({ v: 1, type: "user_message", text: 123 }));
    h.socket.emitMessage(new ArrayBuffer(4)); // binary frame

    expect(h.inbound).toHaveLength(0);
    expect(consoleWarn).toHaveBeenCalledTimes(6);
  });

  it("presence bookkeeping frames never reach the command handler", () => {
    const h = connected();
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "presence", peers: [{ role: "mobile" }] });
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "peer_joined", role: "mobile" });
    h.socket.emitFrame({ v: PROTOCOL_VERSION, type: "peer_left", role: "mobile" });

    expect(h.inbound).toHaveLength(0);
  });

  it("a version_mismatch error surfaces as a fatal error state", () => {
    const h = connected();
    h.socket.emitFrame({
      v: PROTOCOL_VERSION,
      type: "error",
      code: "version_mismatch",
      message: "upgrade required",
    });

    const state = h.client.getState();
    expect(state.status).toBe("error");
  });

  it("a room_closed error surfaces as a fatal error state (credential revoked)", () => {
    const h = connected();
    h.socket.emitFrame({
      v: PROTOCOL_VERSION,
      type: "error",
      code: "room_closed",
      message: "room torn down",
    });

    expect(h.client.getState().status).toBe("error");
  });

  it("transient relay errors are logged, not fatal", () => {
    const h = connected();
    h.socket.emitFrame({
      v: PROTOCOL_VERSION,
      type: "error",
      code: "rate_limited",
      message: "slow down",
    });

    expect(h.client.getState().status).toBe("connected");
    expect(consoleWarn).toHaveBeenCalled();
  });
});

describe("relay-refused credential (1008 policy-violation close)", () => {
  function enabled() {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const socket = h.sockets[0];
    if (!socket) throw new Error("expected socket");
    return { ...h, socket };
  }

  it("a 1008 unauthorized close is fatal: needs-rotate state, socket stopped", () => {
    const h = enabled();
    h.socket.emitOpen();

    h.socket.emitClose(1008, "unauthorized");

    const state = h.client.getState();
    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("expected error state");
    expect(state.message).toContain("unauthorized");
    expect(state.message).toContain("rotate");
    // The socket is closed so PartySocket can't keep redialing a credential
    // the relay will never accept again (the infinite-"connecting" wedge).
    expect(h.socket.closed).toBe(true);
  });

  it("a 1008 invalid_room close is fatal too", () => {
    const h = enabled();
    h.socket.emitClose(1008, "invalid_room");

    const state = h.client.getState();
    expect(state.status).toBe("error");
  });

  it("rotate recovers from the fatal state with a fresh credential", () => {
    const h = enabled();
    h.socket.emitClose(1008, "unauthorized");
    expect(h.client.getState().status).toBe("error");

    const state = h.client.rotateCredential();

    expect(state.status).toBe("connecting");
    expect(h.sockets).toHaveLength(2);
    expect(storedFile(h.fs).credential?.roomId).toBe(h.configs[1]?.room);
  });

  it("a normal close (1000) keeps the reconnecting behavior", () => {
    const h = enabled();
    h.socket.emitOpen();
    h.socket.emitClose(1000, "superseded");

    expect(h.client.getState().status).toBe("connecting");
    expect(h.socket.closed).toBe(false);
  });
});

describe("shutdown", () => {
  it("closes the socket but keeps the credential for the next launch", () => {
    const h = harness();
    h.client.init(h.handler);
    h.client.setEnabled(true);
    const socket = h.sockets[0];
    if (!socket) throw new Error("expected socket");
    socket.emitOpen();

    h.client.shutdown();

    expect(socket.closed).toBe(true);
    // No room_teardown on quit — the room stays claimed for reconnect.
    expect(socket.sentMessages().some((m) => m.type === "room_teardown")).toBe(false);
    expect(storedFile(h.fs).enabled).toBe(true);
    expect(storedFile(h.fs).credential).not.toBeNull();
  });
});
