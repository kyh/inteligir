import {
  ackCapturesRequestSchema,
  captureRequestSchema,
  CAPTURE_CLAIM_TTL_MS,
  claimCapturesRequestSchema,
  type AckCapturesResponse,
  type CaptureResponse,
  type CaptureRow,
  type ClaimCapturesResponse,
} from "@repo/api/cloud/captures/captures-schema";
import {
  pullQuerySchema,
  pushRequestSchema,
  type PullResponse,
  type PushResponse,
  type SyncEventRow,
} from "@repo/api/cloud/sync/sync-schema";
import {
  devicePlatformSchema,
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  type DevicePlatform,
  type SyncPing,
} from "@repo/api/cloud/sync/sync-ws";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { refuse } from "../cloud-http";

// Named `user:<userId>` from the verified credential only: naming an object creates one.
// Hibernation rules: sockets are accepted with ctx.acceptWebSocket, per-socket identity lives in
// the attachment, the broadcast set is rebuilt from ctx.getWebSockets(), and no instance field
// holds anything a later message needs. The Worker is the only caller, so x-device-* is trusted.

type SocketTag = {
  readonly deviceId: string;
  readonly platform: DevicePlatform;
};

type AckResult = AckCapturesResponse["results"][number];

// parsed rather than trusted: a socket hibernated before the tag's shape last changed comes back with the old one
const socketTagSchema = z.object({
  deviceId: z.string().min(1),
  platform: devicePlatformSchema,
});

function readSocketTag(ws: WebSocket): SocketTag | null {
  const tag = socketTagSchema.safeParse(ws.deserializeAttachment());
  return tag.success ? tag.data : null;
}

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

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    // the tombstone refuses a request that verified its credential just before the account was
    // deleted, which would otherwise recreate the purged state; the RPC methods are not gated
    if (this.purgedAt() !== null) {
      return refuse("account-deleted", "This account was deleted.");
    }

    if (route === "GET /ws") return this.openSocket(request);
    if (route === "POST /push") return await this.push(request);
    if (route === "GET /pull") return this.pull(url);
    if (route === "POST /capture") return await this.capture(request);
    if (route === "POST /captures/claim") return await this.claimCaptures(request);
    if (route === "POST /captures/ack") return await this.ackCaptures(request);

    return refuse("not-found", "No such route.");
  }

  private purgedAt(): number | null {
    const row = this.ctx.storage.sql
      .exec<{ purged_at: number }>("SELECT purged_at FROM account_state WHERE id = 1")
      .toArray()[0];
    return row?.purged_at ?? null;
  }

  private openSocket(request: Request): Response {
    const deviceId = request.headers.get("x-device-id");
    if (deviceId === null) return refuse("unauthorized", "No device.");
    const platform = devicePlatformSchema.safeParse(request.headers.get("x-device-platform"));

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const tag: SocketTag = {
      deviceId,
      // a delivery hint, not a capability: an unparseable value degrades to "other"
      platform: platform.success ? platform.data : "other",
    };
    server.serializeAttachment(tag);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(): void {
    // unknown frames are ignored, never closed on: a newer app must not lose its socket over a frame this build predates
  }

  private broadcast(frame: SyncPing, filter: (tag: SocketTag) => boolean): void {
    const body = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      const tag = readSocketTag(ws);
      if (tag === null || !filter(tag)) continue;
      try {
        ws.send(body);
      } catch {
        // torn down between getWebSockets() and send()
      }
    }
  }

  // the pusher is excluded: it already holds what it pushed
  vaultPing(pushingDeviceId: string): void {
    this.broadcast({ type: "vault" }, (tag) => tag.deviceId !== pushingDeviceId);
  }

  // a credential check on the next request does not reach a socket that already has one
  severDevice(deviceId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const tag = readSocketTag(ws);
      if (tag?.deviceId !== deviceId) continue;
      try {
        ws.close(1008, "device revoked");
      } catch {
        // already closing
      }
    }
  }

  private async push(request: Request): Promise<Response> {
    const deviceId = request.headers.get("x-device-id");
    if (deviceId === null) return refuse("unauthorized", "No device.");
    const body = pushRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Malformed push batch.");

    const events = body.data.events;
    // judged before anything is stored: a batch that disagrees with itself has no prefix worth keeping
    for (const [index, event] of events.entries()) {
      const previous = index === 0 ? undefined : events[index - 1];
      if (previous !== undefined && event.deviceSeq <= previous.deviceSeq) {
        return refuse(
          "sync-out-of-order",
          "Batch positions must strictly increase.",
          event.deviceSeq,
        );
      }
    }

    const sql = this.ctx.storage.sql;
    const metaUpserts = body.data.threads ?? [];
    for (const thread of metaUpserts) {
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

    let accepted = 0;
    let duplicates = 0;
    const touchedThreads = new Set<string>();
    for (const event of events) {
      const serialized = JSON.stringify(event.event);
      const stored = sql
        .exec<{ event: string }>(
          "SELECT event FROM sync_events WHERE device_id = ? AND device_seq = ?",
          deviceId,
          event.deviceSeq,
        )
        .toArray()[0];

      if (stored !== undefined) {
        // a different body at a stored position is a buggy outbox; INSERT OR IGNORE would drop the write and call it idempotency
        if (stored.event !== serialized) {
          return refuse(
            "sync-conflict",
            "That outbox position is already stored with a different body.",
            event.deviceSeq,
          );
        }
        duplicates += 1;
        continue;
      }

      if (highWater !== null && event.deviceSeq <= highWater) {
        return refuse(
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
        serialized,
        event.createdAt,
      );
      accepted += 1;
      touchedThreads.add(event.threadId);
    }

    const lastSeq = this.lastSeq();

    if (accepted > 0) {
      // the pusher already holds what it pushed
      this.broadcast({ type: "sync", seq: lastSeq }, (tag) => tag.deviceId !== deviceId);
    }
    // not gated on accepted: registering a desktop-lane thread is itself the dispatch, and may precede its first event
    for (const threadId of this.desktopLaneThreads(touchedThreads, metaUpserts)) {
      this.broadcast(
        { type: "dispatch", threadId },
        (tag) => tag.platform === "desktop" && tag.deviceId !== deviceId,
      );
    }

    const response: PushResponse = { accepted, duplicates, lastSeq };
    return Response.json(response);
  }

  private desktopLaneThreads(
    touched: ReadonlySet<string>,
    metaUpserts: readonly { readonly threadId: string }[],
  ): Set<string> {
    const candidates = new Set<string>(touched);
    for (const meta of metaUpserts) candidates.add(meta.threadId);
    const desktop = new Set<string>();
    for (const threadId of candidates) {
      const row = this.ctx.storage.sql
        .exec<{ lane: string }>("SELECT lane FROM thread_meta WHERE thread_id = ?", threadId)
        .toArray()[0];
      if (row?.lane === "desktop") desktop.add(threadId);
    }
    return desktop;
  }

  private lastSeq(): number {
    return this.ctx.storage.sql
      .exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_events")
      .one().seq;
  }

  private pull(url: URL): Response {
    const query = pullQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) return refuse("bad-request", "Malformed pull cursor.");
    const { afterSeq, limit } = query.data;

    const rows = this.ctx.storage.sql
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

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events: SyncEventRow[] = page.map((row) => ({
      seq: row.seq,
      threadId: row.thread_id,
      deviceId: row.device_id,
      deviceSeq: row.device_seq,
      event: parseStoredEvent(row.event),
      createdAt: row.created_at,
    }));
    const response: PullResponse = { events, lastSeq: this.lastSeq(), hasMore };
    return Response.json(response);
  }

  private async capture(request: Request): Promise<Response> {
    const body = captureRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { text, idempotencyKey }.");
    const sql = this.ctx.storage.sql;

    const existing = sql
      .exec<{ id: string; created_at: number }>(
        "SELECT id, created_at FROM captures WHERE idempotency_key = ?",
        body.data.idempotencyKey,
      )
      .toArray()[0];
    if (existing !== undefined) {
      // a share-sheet retry after a lost response; no ping, nothing changed
      const duplicate: CaptureResponse = {
        id: existing.id,
        createdAt: existing.created_at,
        duplicate: true,
      };
      return Response.json(duplicate);
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    sql.exec(
      "INSERT INTO captures (id, idempotency_key, text, created_at) VALUES (?, ?, ?, ?)",
      id,
      body.data.idempotencyKey,
      body.data.text,
      createdAt,
    );
    // every socket, the capturer included: whichever device claims first applies it, and the capturer may be the only one online
    this.broadcast({ type: "capture" }, () => true);
    const response: CaptureResponse = { id, createdAt, duplicate: false };
    return Response.json(response);
  }

  // the TTL is judged here on read, so a lapsed claim needs no alarm to reclaim
  private async claimCaptures(request: Request): Promise<Response> {
    const body = claimCapturesRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return refuse("bad-request", "Send { limit? }.");

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
        body.data.limit,
      )
      .toArray();

    const captures: CaptureRow[] = rows.map((row) => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    }));
    const response: ClaimCapturesResponse = {
      claimToken,
      captures,
      expiresAt: now + CAPTURE_CLAIM_TTL_MS,
    };
    return Response.json(response);
  }

  // a row reclaimed since is not deleted: this device raced its own lapsed claim, and the current owner will apply it
  private async ackCaptures(request: Request): Promise<Response> {
    const body = ackCapturesRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { claimToken, ids }.");
    const sql = this.ctx.storage.sql;

    const results = body.data.ids.map((id): AckResult => {
      const deleted = sql
        .exec<{ id: string }>(
          "DELETE FROM captures WHERE id = ? AND claim_token = ? RETURNING id",
          id,
          body.data.claimToken,
        )
        .toArray();
      if (deleted.length > 0) return { id, outcome: "deleted" };
      const survivor = sql
        .exec<{ id: string }>("SELECT id FROM captures WHERE id = ?", id)
        .toArray()[0];
      return { id, outcome: survivor === undefined ? "unknown" : "reclaimed" };
    });

    const response: AckCapturesResponse = { results };
    return Response.json(response);
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

// a parse failure is storage corruption; surface the raw string rather than 500 every pull forever
function parseStoredEvent(stored: string): SyncEventRow["event"] {
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
}
