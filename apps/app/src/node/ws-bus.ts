// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// bb's NotificationHub + client protocol, trimmed to this product's four
// entities. Implements DbNotifier at the edge: the write layer announces
// changes, the bus fans them out to the sockets whose subscriptions match.

import type { DbNotifier } from "@repo/db/notifier";
import {
  changedMessageSchema,
  clientMessageSchema,
  helloMessageSchema,
  realtimeSubscriptionTargetKey,
  type ChangedMessage,
  type DocChangeKind,
  type RealtimeSubscriptionTarget,
  type SystemChangeKind,
  type ThreadChangeKind,
  type VaultChangeKind,
} from "@repo/server-contract/notifications";

/** Structural on purpose: production passes hono/ws WSContext, tests a fake. */
export interface BusSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

function subscriptionKeysForMessage(message: ChangedMessage): string[] {
  switch (message.entity) {
    case "system":
      return [realtimeSubscriptionTargetKey({ kind: "system" })];
    case "vault":
      return [realtimeSubscriptionTargetKey({ kind: "vault" })];
    case "doc":
      // `vault` is the doc LIST target, so list surfaces see per-doc changes.
      return [
        realtimeSubscriptionTargetKey({ kind: "vault" }),
        realtimeSubscriptionTargetKey({ kind: "doc-detail", docId: message.id }),
      ];
    case "thread":
      return message.id === undefined
        ? [realtimeSubscriptionTargetKey({ kind: "thread-list" })]
        : [
            realtimeSubscriptionTargetKey({ kind: "thread-list" }),
            realtimeSubscriptionTargetKey({
              kind: "thread-detail",
              threadId: message.id,
            }),
          ];
  }
}

function decodeSocketPayload(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
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
    socket.send(JSON.stringify(helloMessageSchema.parse({ type: "hello", version: this.version })));
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

  notifyVault(changes: VaultChangeKind[]): void {
    this.notifyClients({ type: "changed", entity: "vault", changes });
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

    const parseResult = changedMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    for (const socket of sockets) {
      socket.send(payload);
    }
  }
}
