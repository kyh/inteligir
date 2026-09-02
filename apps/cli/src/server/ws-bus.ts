// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { DocChangeKind, ThreadChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";
import type { DbNotifier } from "@repo/domain/notifier";
import { z } from "zod";
import {
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  subscriptionKeysForMessage,
  type ChangedMessage,
  type HelloMessage,
  type RealtimeSubscriptionTarget,
  type VaultChangedMessage,
} from "@repo/api/local/notifications";

export interface BusSocket {
  close(code?: number, reason?: string): void;
  readyState: number;
  send(data: string): void;
  // the transport under hono's wrapper; only the shutdown path terminates through it.
  readonly raw?: unknown;
}

const SOCKET_OPEN_STATE = 1;

// rfc 6455 going away, so the page can tell a deliberate stop from a dropped connection.
const GOING_AWAY_CLOSE_CODE = 1001;

interface TerminableTransport {
  terminate(): void;
}

// z.custom passes the original object through, keeping terminate() bound to its socket.
const terminableTransportSchema = z.custom<TerminableTransport>(
  (value) =>
    z.looseObject({ terminate: z.custom((member) => member instanceof Function) }).safeParse(value)
      .success,
);

// parsed rather than asserted: the fake sockets tests inject have no raw at all.
export function terminateTransport(socket: { readonly raw?: unknown }): void {
  const transport = terminableTransportSchema.safeParse(socket.raw);
  if (!transport.success) {
    return;
  }
  try {
    transport.data.terminate();
  } catch {
    // A socket already gone is the outcome we wanted.
  }
}

const socketPayloadDecoder = new TextDecoder();

export type SocketPayload = string | Blob | ArrayBufferLike | ArrayBufferView;

function decodeSocketPayload(raw: SocketPayload): string {
  const text = z.string().safeParse(raw);
  if (text.success) {
    return text.data;
  }
  if (raw instanceof ArrayBuffer) {
    return socketPayloadDecoder.decode(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return socketPayloadDecoder.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }
  throw new Error("Unsupported socket payload");
}

export class WsBus implements DbNotifier {
  private readonly keysBySocket = new Map<BusSocket, Set<string>>();
  private readonly socketsByKey = new Map<string, Set<BusSocket>>();

  registerClient(socket: BusSocket): void {
    if (!this.keysBySocket.has(socket)) {
      this.keysBySocket.set(socket, new Set());
    }
    const hello: HelloMessage = { type: "hello" };
    socket.send(JSON.stringify(hello));
  }

  // an upgraded socket is detached from the http server's connection tracking, so server.close()
  // never completes while one is open and closeAllConnections() does not touch it.
  closeAllClients(): void {
    for (const socket of this.keysBySocket.keys()) {
      try {
        socket.close(GOING_AWAY_CLOSE_CODE, "server-shutting-down");
      } catch {
        // Already closing; the terminate pass below is the backstop.
      }
    }
  }

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

  handleMessage(socket: BusSocket, raw: SocketPayload): void {
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

  notifyVault(changes: VaultChangeKind[], paths?: readonly string[]): void {
    const message: VaultChangedMessage = { type: "changed", entity: "vault", changes };
    if (paths !== undefined) message.paths = paths;
    this.notifyClients(message);
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
      // a closing socket stays registered until its onClose fires; sending into it throws on ws.
      if (socket.readyState !== SOCKET_OPEN_STATE) {
        continue;
      }
      socket.send(payload);
    }
  }
}
