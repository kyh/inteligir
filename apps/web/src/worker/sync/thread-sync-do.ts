import { CAPTURE_CLAIM_TTL_MS } from "@repo/api/cloud/captures/captures-schema";
import type {
  AckCapturesRequest,
  AckCapturesResponse,
  CaptureRequest,
  CaptureResponse,
  CaptureRow,
  ClaimCapturesRequest,
  ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import type { PullQuery, PushResponse, ThreadMetaInput } from "@repo/api/cloud/sync/sync-schema";
import {
  devicePlatformSchema,
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  SYNC_WS_REVOKED_CLOSE_CODE,
} from "@repo/api/cloud/sync/sync-ws";
import type { DevicePlatform, SyncPing } from "@repo/api/cloud/sync/sync-ws";
import { DurableObject } from "cloudflare:workers";
import { refuse } from "../cloud-http";

// Named `user:<userId>` from the verified credential only: naming an object creates one. The
// Worker parses every body and calls a method with the verified deviceId as an argument; fetch
// is the socket upgrade alone, since a WebSocket cannot cross RPC, and its identity rides
// SOCKET_IDENTITY_HEADERS, which the Worker strips and stamps. Hibernation rules: sockets are
// accepted with ctx.acceptWebSocket under their device and platform tags, the broadcast set is
// rebuilt from ctx.getWebSockets(), and no instance field holds anything a later message needs.

export const SOCKET_IDENTITY_HEADERS = {
  deviceId: "x-device-id",
  platform: "x-device-platform",
} as const;

export interface SyncRefusal {
  readonly ok: false;
  readonly code: CloudErrorCode;
  readonly message: string;
  readonly deviceSeq?: number;
}

export type SyncResult<T> = { readonly ok: true; readonly value: T } | SyncRefusal;

// an event body crosses as the JSON text the log stores and compares, never as a parsed tree:
// the Worker owns the wire's shape, and a tree would be cloned across only to be stringified
interface StoredEvent {
  readonly createdAt: number;
  readonly deviceSeq: number;
  readonly event: string;
  readonly threadId: string;
}

export interface EventBatch {
  readonly events: readonly StoredEvent[];
  readonly threads: readonly ThreadMetaInput[];
}

interface StoredEventRow extends StoredEvent {
  readonly deviceId: string;
  readonly seq: number;
}

export interface EventPage {
  readonly hasMore: boolean;
  readonly lastSeq: number;
  readonly rows: readonly StoredEventRow[];
}

const accepted = <T>(value: T): SyncResult<T> => ({ ok: true, value });

const refused = (code: CloudErrorCode, message: string, deviceSeq?: number): SyncRefusal =>
  deviceSeq === undefined ? { code, message, ok: false } : { code, deviceSeq, message, ok: false };

type AckResult = AckCapturesResponse["results"][number];

const deviceTag = (deviceId: string): string => `device:${deviceId}`;
const platformTag = (platform: DevicePlatform): string => `platform:${platform}`;

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

export class ThreadSyncDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initSchema();
    // answered by the runtime without waking a hibernated object; a webSocketMessage pong would pin it per heartbeat
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG),
    );
  }

  private initSchema(): void {
    // AUTOINCREMENT: seq is every client's cursor, and rowid reuse after a delete would replay old rows past it
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sync_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL,
        event TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (device_id, device_seq)
      );
      CREATE TABLE IF NOT EXISTS thread_meta (
        thread_id TEXT PRIMARY KEY,
        lane TEXT NOT NULL DEFAULT 'any',
        title TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS captures (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claim_token TEXT,
        claimed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS account_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        purged_at INTEGER NOT NULL
      );
    `);
  }

  // the tombstone refuses a call that verified its credential just before the account was
  // deleted, which would otherwise recreate the purged state; every method that reads or writes
  // the account's state asks it first, and the pings, which touch none, do not
  private tombstone(): SyncRefusal | null {
    const [row] = this.ctx.storage.sql
      .exec<{ purged_at: number }>("SELECT purged_at FROM account_state WHERE id = 1")
      .toArray();
    return row === undefined ? null : refused("account-deleted", "This account was deleted.");
  }

  override fetch(request: Request): Response {
    const gone = this.tombstone();
    if (gone !== null) {
      return refuse(gone.code, gone.message);
    }
    const deviceId = request.headers.get(SOCKET_IDENTITY_HEADERS.deviceId);
    if (deviceId === null) {
      return refuse("unauthorized", "No device.");
    }
    const platform = devicePlatformSchema.safeParse(
      request.headers.get(SOCKET_IDENTITY_HEADERS.platform),
    );

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [
      deviceTag(deviceId),
      // a delivery hint, not a capability: an unparseable value degrades to "other"
      platformTag(platform.success ? platform.data : "other"),
    ]);
    return new Response(null, { status: 101, webSocket: client });
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketMessage(): void {
    // unknown frames are ignored, never closed on: a newer app must not lose its socket over a frame this build predates
  }

  private socketsExcept(deviceId: string, tag?: string): WebSocket[] {
    const own = deviceTag(deviceId);
    return this.ctx.getWebSockets(tag).filter((ws) => !this.ctx.getTags(ws).includes(own));
  }

  // the pusher is excluded: it already holds what it pushed
  vaultPing(pushingDeviceId: string): void {
    broadcast({ type: "vault" }, this.socketsExcept(pushingDeviceId));
  }

  // a credential check on the next request does not reach a socket that already has one
  severDevice(deviceId: string): void {
    for (const ws of this.ctx.getWebSockets(deviceTag(deviceId))) {
      try {
        ws.close(SYNC_WS_REVOKED_CLOSE_CODE, "device revoked");
      } catch {
        // already closing
      }
    }
  }

  push(deviceId: string, batch: EventBatch): SyncResult<PushResponse> {
    const gone = this.tombstone();
    if (gone !== null) {
      return gone;
    }
    const { events } = batch;
    // judged before anything is stored: a batch that disagrees with itself has no prefix worth keeping
    for (const [index, event] of events.entries()) {
      const previous = index === 0 ? undefined : events[index - 1];
      if (previous !== undefined && event.deviceSeq <= previous.deviceSeq) {
        return refused(
          "sync-out-of-order",
          "Batch positions must strictly increase.",
          event.deviceSeq,
        );
      }
    }

    const { sql } = this.ctx.storage;
    for (const thread of batch.threads) {
      // last-writer-wins on the client's timestamp: a delayed retry carries an old updated_at and
      // loses, where a server-side now would silently undo a since-changed lane
      sql.exec(
        `INSERT INTO thread_meta (thread_id, lane, title, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (thread_id) DO UPDATE SET
           lane = excluded.lane,
           title = COALESCE(excluded.title, thread_meta.title),
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > thread_meta.updated_at`,
        thread.threadId,
        thread.lane,
        thread.title ?? null,
        thread.updatedAt,
      );
    }

    const highWater = sql
      .exec<{ high: number | null }>(
        "SELECT MAX(device_seq) AS high FROM sync_events WHERE device_id = ?",
        deviceId,
      )
      .one().high;

    let stored = 0;
    let duplicates = 0;
    const touchedThreads = new Set<string>();
    for (const event of events) {
      const [existing] = sql
        .exec<{ event: string }>(
          "SELECT event FROM sync_events WHERE device_id = ? AND device_seq = ?",
          deviceId,
          event.deviceSeq,
        )
        .toArray();

      if (existing !== undefined) {
        // a different body at a stored position is a buggy outbox; INSERT OR IGNORE would drop the write and call it idempotency
        if (existing.event !== event.event) {
          return refused(
            "sync-conflict",
            "That outbox position is already stored with a different body.",
            event.deviceSeq,
          );
        }
        duplicates += 1;
        continue;
      }

      if (highWater !== null && event.deviceSeq <= highWater) {
        return refused(
          "sync-out-of-order",
          "That outbox position is below this device's high-water mark.",
          event.deviceSeq,
        );
      }

      sql.exec(
        "INSERT INTO sync_events (thread_id, device_id, device_seq, event, created_at) VALUES (?, ?, ?, ?, ?)",
        event.threadId,
        deviceId,
        event.deviceSeq,
        event.event,
        event.createdAt,
      );
      stored += 1;
      touchedThreads.add(event.threadId);
    }

    const lastSeq = this.lastSeq();

    if (stored > 0) {
      broadcast({ seq: lastSeq, type: "sync" }, this.socketsExcept(deviceId));
    }
    // not gated on stored: registering a desktop-lane thread is itself the dispatch, and may precede its first event
    const desktops = this.socketsExcept(deviceId, platformTag("desktop"));
    for (const threadId of this.desktopLaneThreads(touchedThreads, batch.threads)) {
      broadcast({ threadId, type: "dispatch" }, desktops);
    }

    return accepted({ accepted: stored, duplicates, lastSeq });
  }

  private desktopLaneThreads(
    touched: ReadonlySet<string>,
    metaUpserts: readonly { readonly threadId: string }[],
  ): Set<string> {
    const candidates = new Set<string>(touched);
    for (const meta of metaUpserts) {
      candidates.add(meta.threadId);
    }
    const desktop = new Set<string>();
    for (const threadId of candidates) {
      const [row] = this.ctx.storage.sql
        .exec<{ lane: string }>("SELECT lane FROM thread_meta WHERE thread_id = ?", threadId)
        .toArray();
      if (row?.lane === "desktop") {
        desktop.add(threadId);
      }
    }
    return desktop;
  }

  private lastSeq(): number {
    return this.ctx.storage.sql
      .exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_events")
      .one().seq;
  }

  pull(query: PullQuery): SyncResult<EventPage> {
    const gone = this.tombstone();
    if (gone !== null) {
      return gone;
    }
    const { afterSeq, limit } = query;
    const found = this.ctx.storage.sql
      .exec<{
        seq: number;
        thread_id: string;
        device_id: string;
        device_seq: number;
        event: string;
        created_at: number;
      }>(
        "SELECT seq, thread_id, device_id, device_seq, event, created_at FROM sync_events WHERE seq > ? ORDER BY seq LIMIT ?",
        afterSeq,
        limit + 1,
      )
      .toArray();

    const hasMore = found.length > limit;
    const rows = (hasMore ? found.slice(0, limit) : found).map((row): StoredEventRow => ({
      createdAt: row.created_at,
      deviceId: row.device_id,
      deviceSeq: row.device_seq,
      event: row.event,
      seq: row.seq,
      threadId: row.thread_id,
    }));
    return accepted({ hasMore, lastSeq: this.lastSeq(), rows });
  }

  capture(request: CaptureRequest): SyncResult<CaptureResponse> {
    const gone = this.tombstone();
    if (gone !== null) {
      return gone;
    }
    const { sql } = this.ctx.storage;
    const [existing] = sql
      .exec<{ id: string; created_at: number }>(
        "SELECT id, created_at FROM captures WHERE idempotency_key = ?",
        request.idempotencyKey,
      )
      .toArray();
    if (existing !== undefined) {
      // a share-sheet retry after a lost response; no ping, nothing changed
      return accepted({ createdAt: existing.created_at, duplicate: true, id: existing.id });
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    sql.exec(
      "INSERT INTO captures (id, idempotency_key, text, created_at) VALUES (?, ?, ?, ?)",
      id,
      request.idempotencyKey,
      request.text,
      createdAt,
    );
    // every socket, the capturer included: whichever device claims first applies it, and the capturer may be the only one online
    broadcast({ type: "capture" }, this.ctx.getWebSockets());
    return accepted({ createdAt, duplicate: false, id });
  }

  // the TTL is judged here on read, so a lapsed claim needs no alarm to reclaim
  claimCaptures(request: ClaimCapturesRequest): SyncResult<ClaimCapturesResponse> {
    const gone = this.tombstone();
    if (gone !== null) {
      return gone;
    }
    const now = Date.now();
    const claimToken = crypto.randomUUID();
    const rows = this.ctx.storage.sql
      .exec<{ id: string; text: string; created_at: number }>(
        `UPDATE captures SET claim_token = ?, claimed_at = ?
         WHERE id IN (
           SELECT id FROM captures
           WHERE claim_token IS NULL OR claimed_at <= ?
           ORDER BY created_at, id LIMIT ?
         )
         RETURNING id, text, created_at`,
        claimToken,
        now,
        now - CAPTURE_CLAIM_TTL_MS,
        request.limit,
      )
      .toArray();

    const captures: CaptureRow[] = rows.map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      text: row.text,
    }));
    return accepted({ captures, claimToken, expiresAt: now + CAPTURE_CLAIM_TTL_MS });
  }

  // a row reclaimed since is not deleted: this device raced its own lapsed claim, and the current owner will apply it
  ackCaptures(request: AckCapturesRequest): SyncResult<AckCapturesResponse> {
    const gone = this.tombstone();
    if (gone !== null) {
      return gone;
    }
    const { sql } = this.ctx.storage;
    const results = request.ids.map((id): AckResult => {
      const deleted = sql
        .exec<{ id: string }>(
          "DELETE FROM captures WHERE id = ? AND claim_token = ? RETURNING id",
          id,
          request.claimToken,
        )
        .toArray();
      if (deleted.length > 0) {
        return { id, outcome: "deleted" };
      }
      const [survivor] = sql
        .exec<{ id: string }>("SELECT id FROM captures WHERE id = ?", id)
        .toArray();
      return { id, outcome: survivor === undefined ? "unknown" : "reclaimed" };
    });
    return accepted({ results });
  }

  // the tombstone is written last so a request that verified just before the account died cannot rebuild what this removed; idempotent
  async purge(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, "account deleted");
      } catch {
        // already closing
      }
    }
    // deleteAll on a SQLite-backed object clears the SQL tables too
    await this.ctx.storage.deleteAll();
    this.initSchema();
    this.ctx.storage.sql.exec(
      "INSERT INTO account_state (id, purged_at) VALUES (1, ?) ON CONFLICT (id) DO NOTHING",
      Date.now(),
    );
  }
}
