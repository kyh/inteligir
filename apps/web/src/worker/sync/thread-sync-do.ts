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

// ---------------------------------------------------------------------------
// ThreadSyncDO — ONE per user, named `user:<userId>` where the userId comes
// from the VERIFIED device credential (or the session, for the purge hook) —
// never from anything a caller typed, because naming an object CREATES one.
//
// It owns three things, all in its own SQLite:
//   • the append-only MERGED thread-event log — every device's outbox rows,
//     server-stamped with one global `seq`, keyed (device_id, device_seq).
//     A replay of a stored position is accepted only when the body MATCHES;
//     a different body is a conflict and a new position at or below the
//     device's high-water is causal reverse. Event bodies are opaque JSON:
//     this object stores and fans out, it never interprets.
//   • thread metadata (lane, title), last-writer-wins on the CLIENT's own
//     timestamp — the lane is what makes the log double as a DISPATCH MAILBOX.
//   • the capture inbox — two-phase: claim takes ownership for a window, ack
//     deletes by that claim's token. `@repo/api/cloud/captures/captures-schema` states
//     the guarantee that buys (at-least-once delivery, exactly-once deletion).
//
// HIBERNATION RULES: sockets are accepted
// with `ctx.acceptWebSocket`, per-socket identity lives in the socket's own
// attachment, the broadcast set is rebuilt from `ctx.getWebSockets()` on every
// push, and NO instance field holds anything a later message needs. There is
// no alarm: the one deadline here — a claim's TTL — is judged on READ, so it
// needs no wake to pass.
//
// The Worker is the ONLY caller (a Durable Object has no public address): it
// verifies the device credential against D1 first and forwards with
// `x-device-id` / `x-device-platform` stamped. Those headers are trusted here
// precisely because no request reaches this fetch without passing that check.
//
// `fetch` carries the six DEVICE routes and nothing else. The Worker's own
// three operations — purge, severDevice, vaultPing — are RPC METHODS: they
// take typed arguments rather than a fabricated request re-parsed against a
// wire shape, and no device path can reach them.
// ---------------------------------------------------------------------------

type SocketTag = {
  readonly deviceId: string;
  readonly platform: DevicePlatform;
};

/** One id's ack outcome, as the contract's response declares it. */
type AckResult = AckCapturesResponse["results"][number];

/** What this object wrote with `serializeAttachment`, read back. Parsed rather
 *  than trusted: a socket hibernated before the tag's shape last changed comes
 *  back carrying the OLD one, and an untagged socket is one this object no
 *  longer knows how to address. */
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
    // Keepalive answered by the runtime WITHOUT waking a hibernated object —
    // a `webSocketMessage` pong would pin the object per heartbeat.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG),
    );
  }

  private initSchema(): void {
    // AUTOINCREMENT is deliberate: `seq` is the sync cursor every client
    // stores, so it must never be reused — plain rowid reuse after a delete
    // would replay old rows into a cursor that already passed them.
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

    // The purge tombstone. Written AFTER deleteAll, so it survives the wipe it
    // records — and it is what closes the deletion race: a request that
    // verified its credential microseconds before the account was deleted can
    // still arrive here, and without this it would recreate the state the
    // purge just removed. Every wire route is gated on it; the RPC methods
    // are not — the two socket ones touch no storage, and `purge` is the
    // write that sets it.
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

  // -- the socket ----------------------------------------------------------

  private openSocket(request: Request): Response {
    const deviceId = request.headers.get("x-device-id");
    if (deviceId === null) return refuse("unauthorized", "No device.");
    const platform = devicePlatformSchema.safeParse(request.headers.get("x-device-platform"));

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const tag: SocketTag = {
      deviceId,
      // A delivery hint, not a capability — an unparseable value degrades to
      // "other" rather than refusing the socket.
      platform: platform.success ? platform.data : "other",
    };
    server.serializeAttachment(tag);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(): void {
    // Invalidation-only, one direction. Unknown client frames are ignored
    // (never closed on): a newer app against an older cloud must not lose its
    // socket over a frame this build predates.
  }

  private broadcast(frame: SyncPing, filter: (tag: SocketTag) => boolean): void {
    const body = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      const tag = readSocketTag(ws);
      if (tag === null || !filter(tag)) continue;
      try {
        ws.send(body);
      } catch {
        // A socket torn down between getWebSockets() and send() — its close
        // event is already on its way; nothing to do.
      }
    }
  }

  /**
   * The hosted vault repo advanced: poke every OTHER device to run a vault
   * sync pass. The pusher — the verified device the vault git wrapper names —
   * is excluded the way `sync` pings exclude theirs: it already holds what it
   * pushed, and the echo would cost it a no-op fetch per push.
   */
  vaultPing(pushingDeviceId: string): void {
    this.broadcast({ type: "vault" }, (tag) => tag.deviceId !== pushingDeviceId);
  }

  /**
   * Close every socket a revoked device holds. Revocation is the lost-device
   * hatch, and a credential check on the next REQUEST does not reach a socket
   * that already has one: without this, a revoked laptop keeps receiving every
   * thread ping until it disconnects on its own.
   */
  severDevice(deviceId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const tag = readSocketTag(ws);
      if (tag?.deviceId !== deviceId) continue;
      try {
        ws.close(1008, "device revoked");
      } catch {
        // Already closing.
      }
    }
  }

  // -- the merged log ------------------------------------------------------

  private async push(request: Request): Promise<Response> {
    const deviceId = request.headers.get("x-device-id");
    if (deviceId === null) return refuse("unauthorized", "No device.");
    const body = pushRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Malformed push batch.");

    const events = body.data.events;
    // Ordering is a property of the WHOLE batch, so it is judged before any of
    // it is stored — a batch that disagrees with itself has no prefix worth
    // keeping.
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
      // Last-writer-wins on the CLIENT's timestamp: a delayed retry carries an
      // OLD updated_at and loses, where a server-side `now` would make it the
      // newest fact on the row and silently undo a since-changed lane.
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
        // The retry path — but only for the SAME body. A different body at a
        // stored position is a buggy outbox, and `INSERT OR IGNORE` would have
        // called that idempotency while dropping the write on the floor.
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
      // The pusher's own sockets are skipped: it holds what it pushed, and a
      // self-ping would only trigger a pull that returns its own rows.
      this.broadcast({ type: "sync", seq: lastSeq }, (tag) => tag.deviceId !== deviceId);
    }
    // Dispatch is NOT gated on accepted: registering a desktop-lane thread is
    // itself the dispatch, and a phone that files the thread before its first
    // event would otherwise poke nobody.
    for (const threadId of this.desktopLaneThreads(touchedThreads, metaUpserts)) {
      this.broadcast(
        { type: "dispatch", threadId },
        (tag) => tag.platform === "desktop" && tag.deviceId !== deviceId,
      );
    }

    const response: PushResponse = { accepted, duplicates, lastSeq };
    return Response.json(response);
  }

  /** The dispatch set: threads this push touched (rows OR meta) whose lane is
   * `desktop` — a dispatch is one push carrying the thread and its first
   * events together, and either half alone must still ping. */
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

  // -- the capture inbox ---------------------------------------------------

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
      // The share-sheet retry after a lost response — the same capture, not a
      // second thought. No ping: nothing changed for anyone.
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
    // Every socket, the capturing device's included: whichever device claims
    // first applies it, and the capturer may well be the only one online.
    this.broadcast({ type: "capture" }, () => true);
    const response: CaptureResponse = { id, createdAt, duplicate: false };
    return Response.json(response);
  }

  /**
   * Phase one: take ownership of a batch. Unclaimed rows and rows whose claim
   * has lapsed are equally available — the TTL is judged HERE, on read, which
   * is why the inbox needs no alarm to reclaim after a crash.
   */
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

  /**
   * Phase two: delete what this claim still owns, and say per id what actually
   * happened. A row that has since been reclaimed is NOT deleted — this
   * device's apply raced its own lapsed claim, and the current owner will
   * apply it again.
   */
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

  // -- account deletion ----------------------------------------------------

  /** Drop everything this object holds, then TOMBSTONE it. Sockets first (a
   * purged account has no live-follow), then the storage whole; the tombstone
   * is written last so a request that verified its credential just before the
   * account died cannot rebuild what this removed. Idempotent — the deletion
   * hook may retry. */
  async purge(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, "account deleted");
      } catch {
        // Already closing.
      }
    }
    // deleteAll on a SQLite-backed object clears the SQL tables too.
    await this.ctx.storage.deleteAll();
    this.initSchema();
    this.ctx.storage.sql.exec(
      "INSERT INTO account_state (id, purged_at) VALUES (1, ?) ON CONFLICT (id) DO NOTHING",
      Date.now(),
    );
  }
}

/** Stored bodies were serialized from a contract-validated JSON value, so a
 * parse failure here is storage corruption — surface the raw string rather
 * than throw a pull into a 500 forever. */
function parseStoredEvent(stored: string): SyncEventRow["event"] {
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
}
