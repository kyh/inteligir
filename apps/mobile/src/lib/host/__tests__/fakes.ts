// In-memory fakes for the host-connection runtime, so the PURE logic runs on
// node with no react-native / expo-secure-store / real sockets. Mirrors the
// sync suite's fakes: tests drive the injected ports, never native modules.

import type { WsConstructor, WsLike } from "@repo/bridge/ws-bridge";
import {
  createEnvironmentStore,
  type EnvironmentStore,
  type StringStorePort,
} from "../environment-store";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function memStringStore(): { port: StringStorePort; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    port: {
      get: (key) => data.get(key) ?? null,
      set: (key, value) => {
        data.set(key, value);
      },
      delete: (key) => {
        data.delete(key);
      },
    },
  };
}

export function memEnvironmentStore(): { store: EnvironmentStore; data: Map<string, string> } {
  const { port, data } = memStringStore();
  return { store: createEnvironmentStore(port), data };
}

// ---------------------------------------------------------------------------
// WebSocket — a WsLike whose events the test fires by hand.
// ---------------------------------------------------------------------------

type WsListener = (event: { data?: unknown; type?: string; code?: number }) => void;

export class FakeSocket implements WsLike {
  binaryType = "";
  readonly url: string;
  readonly sent: Array<string | Uint8Array> = [];
  closedWith: { code?: number | undefined; reason?: string | undefined } | null = null;
  private readonly listeners = new Map<string, WsListener[]>();

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  addEventListener(type: "open" | "message" | "close" | "error", listener: WsListener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  // ---- test drivers (server side) ----
  fireOpen(): void {
    this.emit("open", { type: "open" });
  }

  fireMessage(data: unknown): void {
    this.emit("message", { type: "message", data });
  }

  fireClose(code?: number): void {
    this.emit("close", code === undefined ? { type: "close" } : { type: "close", code });
  }

  private emit(type: string, event: { data?: unknown; type?: string; code?: number }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** A WsConstructor that records every socket it constructs. */
export function fakeWebSocketImpl(): { impl: WsConstructor; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const impl = class extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  };
  return { impl, sockets };
}

/** The most recently constructed socket — errors-as-hard-failure in tests. */
export function lastSocket(sockets: FakeSocket[]): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error("no socket was constructed");
  return socket;
}
