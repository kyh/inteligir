// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { DocChangeKind, ThreadChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";
import type { DbNotifier } from "@repo/domain/notifier";
import { z } from "zod";
import {
  clientMessageSchema,
  realtimeSubscriptionTargetKey,
  subscriptionKeysForMessage,
} from "@repo/api/local/notifications";
import type {
  ChangedMessage,
  HelloMessage,
  RealtimeSubscriptionTarget,
  VaultChangedMessage,
} from "@repo/api/local/notifications";

export interface BusSocket {
  close: (code?: number, reason?: string) => void;
  readyState: number;
  send: (data: string) => void;
}

const SOCKET_OPEN_STATE = 1;

const socketPayloadDecoder = new TextDecoder();

export type SocketPayload = string | Blob | ArrayBufferLike | ArrayBufferView;

const decodeSocketPayload = (raw: SocketPayload): string => {
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
};

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
      case "subscribe": {
        this.subscribe(socket, parsed.target);
        break;
      }
      case "unsubscribe": {
        this.unsubscribe(socket, parsed.target);
        break;
      }
      // no default
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
    const message: VaultChangedMessage = { changes, entity: "vault", type: "changed" };
    if (paths !== undefined) {
      message.paths = paths;
    }
    this.notifyClients(message);
  }

  notifyDoc(docId: string, changes: DocChangeKind[]): void {
    this.notifyClients({ changes, entity: "doc", id: docId, type: "changed" });
  }

  notifyThread(threadId: string, changes: ThreadChangeKind[]): void {
    this.notifyClients({
      changes,
      entity: "thread",
      id: threadId,
      type: "changed",
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
