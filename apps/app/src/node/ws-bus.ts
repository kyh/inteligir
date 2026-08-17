// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// The invalidation bus: implements DbNotifier at the edge — the write layer
// announces changes, the bus fans them out to the sockets whose
// subscriptions match.

import type { DbNotifier } from "@repo/db/notifier";
import {
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  subscriptionKeysForMessage,
  type ChangedMessage,
  type DocChangeKind,
  type HelloMessage,
  type RealtimeSubscriptionTarget,
  type SystemChangeKind,
  type ThreadChangeKind,
  type VaultChangeKind,
} from "@repo/server-contract/notifications";

/** Structural on purpose: production passes hono/ws WSContext, tests a fake. */
export interface BusSocket {
  close(code?: number, reason?: string): void;
  readyState: number;
  send(data: string): void;
  /** The transport under hono's wrapper — `ws`'s WebSocket in production,
   *  absent in tests. Only the shutdown path reaches for it, and only to
   *  TERMINATE a socket that ignored its close frame. */
  readonly raw?: unknown;
}

const SOCKET_OPEN_STATE = 1;

/** RFC 6455 "going away" — what a server that is shutting down owes a client,
 *  so the page can distinguish a deliberate stop from a dropped connection. */
const GOING_AWAY_CLOSE_CODE = 1001;

/** Invoke `raw.terminate()` if the transport has one. Narrowed rather than
 *  asserted: the fake sockets the tests inject have no raw at all. */
function terminateTransport(socket: BusSocket): void {
  const raw = socket.raw;
  if (typeof raw !== "object" || raw === null || !("terminate" in raw)) {
    return;
  }
  const terminate: unknown = Reflect.get(raw, "terminate");
  if (typeof terminate !== "function") {
    return;
  }
  try {
    Reflect.apply(terminate, raw, []);
  } catch {
    // A socket already gone is the outcome we wanted.
  }
}

const socketPayloadDecoder = new TextDecoder();

function decodeSocketPayload(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return socketPayloadDecoder.decode(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return socketPayloadDecoder.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }
  throw new Error("Unsupported socket payload");
}

export interface WsBusOptions {
  /** Echoed in the hello ack frame so clients can detect version skew. */
  version: string;
}

export class WsBus implements DbNotifier {
  private readonly keysBySocket = new Map<BusSocket, Set<string>>();
  private readonly socketsByKey = new Map<string, Set<BusSocket>>();
  private readonly version: string;

  constructor(options: WsBusOptions) {
    this.version = options.version;
  }

  /** Called on socket open; acks with the hello frame. */
  registerClient(socket: BusSocket): void {
    if (!this.keysBySocket.has(socket)) {
      this.keysBySocket.set(socket, new Set());
    }
    // Outbound frames are house-constructed against the contract types, so
    // they serialize directly — ws-bus.test.ts parses every frame the bus can
    // emit against the strict schemas instead of paying a parse per send.
    const hello: HelloMessage = { type: "hello", version: this.version };
    socket.send(JSON.stringify(hello));
  }

  /**
   * Ask every client to go away. Shutdown's FIRST act, and it has to be
   * explicit: an upgraded socket is detached from the HTTP server's connection
   * tracking, so `server.close()` never completes while one is open and
   * `closeAllConnections()` does not touch it — the whole teardown stalls
   * behind a single open tab.
   */
  closeAllClients(): void {
    for (const socket of this.keysBySocket.keys()) {
      try {
        socket.close(GOING_AWAY_CLOSE_CODE, "server-shutting-down");
      } catch {
        // Already closing; the terminate pass below is the backstop.
      }
    }
  }

  /** The deadline behind {@link closeAllClients}: a client that ignored the
   *  close frame has its transport destroyed. */
  terminateAllClients(): void {
    for (const socket of this.keysBySocket.keys()) {
      terminateTransport(socket);
    }
  }

  unregisterClient(socket: BusSocket): void {
    const keys = this.keysBySocket.get(socket);
    if (keys) {
      for (const key of keys) {
        const sockets = this.socketsByKey.get(key);
        if (!sockets) {
          continue;
        }
        sockets.delete(socket);
        if (sockets.size === 0) {
          this.socketsByKey.delete(key);
        }
      }
    }
    this.keysBySocket.delete(socket);
  }

  /** Inbound frames are parsed strictly; anything else closes the socket. */
  handleMessage(socket: BusSocket, raw: unknown): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeSocketPayload(raw));
    } catch {
      socket.close(1008, "invalid-message");
      return;
    }

    const result = clientMessageSchema.safeParse(decoded);
    if (!result.success) {
      socket.close(1008, "invalid-message");
      return;
    }
    const parsed = result.data;

    switch (parsed.type) {
      case "subscribe":
        this.subscribe(socket, parsed.target);
        break;
      case "unsubscribe":
        this.unsubscribe(socket, parsed.target);
        break;
    }
  }

  subscribe(socket: BusSocket, target: RealtimeSubscriptionTarget): void {
    if (!this.keysBySocket.has(socket)) {
      this.keysBySocket.set(socket, new Set());
    }
    const key = realtimeSubscriptionTargetKey(target);
    this.keysBySocket.get(socket)?.add(key);

    const sockets = this.socketsByKey.get(key) ?? new Set<BusSocket>();
    sockets.add(socket);
    this.socketsByKey.set(key, sockets);
  }

  unsubscribe(socket: BusSocket, target: RealtimeSubscriptionTarget): void {
    const key = realtimeSubscriptionTargetKey(target);
    this.keysBySocket.get(socket)?.delete(key);

    const sockets = this.socketsByKey.get(key);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByKey.delete(key);
    }
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifyClients({ type: "changed", entity: "system", changes });
  }

  notifyVault(changes: VaultChangeKind[], paths?: readonly string[]): void {
    this.notifyClients({
      type: "changed",
      entity: "vault",
      changes,
      ...(paths === undefined ? {} : { paths }),
    });
  }

  notifyDoc(docId: string, changes: DocChangeKind[]): void {
    this.notifyClients({ type: "changed", entity: "doc", id: docId, changes });
  }

  notifyThread(threadId: string, changes: ThreadChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "thread",
      id: threadId,
      changes,
    });
  }

  private notifyClients(message: ChangedMessage): void {
    const sockets = new Set<BusSocket>();
    for (const key of subscriptionKeysForMessage(message)) {
      const keySockets = this.socketsByKey.get(key);
      if (!keySockets) {
        continue;
      }
      for (const socket of keySockets) {
        sockets.add(socket);
      }
    }
    if (sockets.size === 0) {
      return;
    }

    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      // A closing/closed socket stays registered until its onClose fires;
      // sending into it throws on ws and silently drops elsewhere.
      if (socket.readyState !== SOCKET_OPEN_STATE) {
        continue;
      }
      socket.send(payload);
    }
  }
}
