import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  SYNC_WS_REVOKED_CLOSE_CODE,
} from "@repo/contract/cloud/sync/sync-ws";
import type { SyncPing } from "@repo/contract/cloud/sync/sync-ws";
import { DurableObject } from "cloudflare:workers";
import { refuse } from "../cloud-http";

// One per account, named `user:<userId>` from the verified credential only: naming an object
// creates one. It holds the account's live sockets and nothing else, so it stores no row: a vault
// push pings the other devices, a revoke closes that device's sockets, and an account deletion
// closes them all. The Worker calls each by RPC with the verified deviceId as an argument; fetch is
// the socket upgrade alone, since a WebSocket cannot cross RPC, and its identity rides
// SOCKET_IDENTITY_HEADERS, which the Worker strips and stamps. Hibernation rules: a socket is
// accepted with ctx.acceptWebSocket under its device's tag, the set a ping reaches is rebuilt from
// ctx.getWebSockets(), and no instance field holds anything a later message needs.

// the object stores nothing of its own, so any table it holds (SQLite's and Cloudflare's internal
// ones are named sqlite_* and _cf_*) is the retired thread log's, which goes with the rest
export const dropRetiredTables = async (storage: DurableObjectStorage): Promise<void> => {
  const held = storage.sql
    .exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' LIMIT 1",
    )
    .toArray();
  if (held.length > 0) {
    await storage.deleteAll();
  }
};

export const SOCKET_IDENTITY_HEADERS = { deviceId: "x-device-id" } as const;

const deviceTag = (deviceId: string): string => `device:${deviceId}`;

const broadcast = (frame: SyncPing, sockets: readonly WebSocket[]): void => {
  const body = JSON.stringify(frame);
  for (const ws of sockets) {
    try {
      ws.send(body);
    } catch {
      // torn down between getWebSockets() and send()
    }
  }
};

const closeEach = (sockets: readonly WebSocket[], code: number, reason: string): void => {
  for (const ws of sockets) {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
  }
};

export class AccountSocketDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // deployed under the retired thread log's class name (cloudflare.config.ts), so an object that
    // still holds that log's tables drops them before it answers anything
    void ctx.blockConcurrencyWhile(async () => {
      await dropRetiredTables(ctx.storage);
    });
    // answered by the runtime without waking a hibernated object; a webSocketMessage pong would pin it per heartbeat
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG),
    );
  }

  override fetch(request: Request): Response {
    const deviceId = request.headers.get(SOCKET_IDENTITY_HEADERS.deviceId);
    if (deviceId === null) {
      return refuse("unauthorized", "No device.");
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [deviceTag(deviceId)]);
    return new Response(null, { status: 101, webSocket: client });
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketMessage(): void {
    // unknown frames are ignored, never closed on: a newer app must not lose its socket over a frame this build predates
  }

  // the pusher is excluded: it already holds what it pushed
  vaultPing(pushingDeviceId: string): void {
    const own = deviceTag(pushingDeviceId);
    broadcast(
      { type: "vault" },
      this.ctx.getWebSockets().filter((ws) => !this.ctx.getTags(ws).includes(own)),
    );
  }

  // a credential check on the next request does not reach a socket that already has one
  severDevice(deviceId: string): void {
    closeEach(
      this.ctx.getWebSockets(deviceTag(deviceId)),
      SYNC_WS_REVOKED_CLOSE_CODE,
      "device revoked",
    );
  }

  // idempotent. no tombstone: the object stores nothing an upgrade verified just before the revoke
  // could rebuild, and a socket that opens after this hears nothing, since the vault it would be
  // pinged about is gone
  closeAll(): void {
    closeEach(this.ctx.getWebSockets(), 1001, "account deleted");
  }
}
