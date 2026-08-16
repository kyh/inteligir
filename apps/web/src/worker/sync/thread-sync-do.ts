import {
  ackCapturesRequestSchema,
  captureRequestSchema,
  type AckCapturesResponse,
  type CaptureResponse,
  type ListCapturesResponse,
} from "@repo/cloud-contract/captures";
import {
  pullQuerySchema,
  pushRequestSchema,
  type PullResponse,
  type PushResponse,
  type SyncEventRow,
} from "@repo/cloud-contract/sync";
import {
  devicePlatformSchema,
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  type DevicePlatform,
  type SyncPing,
} from "@repo/cloud-contract/ws";
import { DurableObject } from "cloudflare:workers";
import { refuse } from "../cloud-http";

// ---------------------------------------------------------------------------
// ThreadSyncDO — ONE per user, named `user:<userId>` where the userId comes
// from the VERIFIED device credential (or the session, for the purge hook) —
// never from anything a caller typed, because naming an object CREATES one.
//
// It owns three things, all in its own SQLite:
//   • the append-only MERGED thread-event log — every device's outbox rows,
//     server-stamped with one global `seq`, idempotent on (device_id,
//     device_seq). Event bodies are opaque JSON: this object stores and fans
//     out, it never interprets.
//   • thread metadata (lane, title) — the lane is what makes the log double as
//     a DISPATCH MAILBOX: a `desktop`-lane thread landing new work pings
//     desktop sockets specifically.
//   • the capture inbox — durable rows until a device acks; the ack DELETES,
//     which is the exactly-once handoff.
//
// HIBERNATION RULES (the old codebase's law, carried): sockets are accepted
// with `ctx.acceptWebSocket`, per-socket identity lives in the socket's own
// attachment, the broadcast set is rebuilt from `ctx.getWebSockets()` on every
// push, and NO instance field holds anything a later message needs. There is
// no alarm: nothing here has a deadline — pairing-code expiry lives in D1 and
// is judged at redeem.
//
// The Worker is the ONLY caller (a Durable Object has no public address): it
// verifies the device credential against D1 first and forwards with
// `x-device-id` / `x-device-platform` stamped. Those headers are trusted here
// precisely because no request reaches this fetch without passing that check.
// ---------------------------------------------------------------------------

type SocketTag = {
  readonly deviceId: string;
  readonly platform: DevicePlatform;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSocketTag(ws: WebSocket): SocketTag | null {
  const raw: unknown = ws.deserializeAttachment();
  if (!isRecord(raw)) return null;
  const { deviceId, platform } = raw;
  if (typeof deviceId !== "string" || deviceId === "") return null;
  const parsedPlatform = devicePlatformSchema.safeParse(platform);
  if (!parsedPlatform.success) return null;
  return { deviceId, platform: parsedPlatform.data };
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
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    if (route === "GET /ws") return this.openSocket(request);
    if (route === "POST /push") return await this.push(request);
    if (route === "GET /pull") return this.pull(url);
    if (route === "POST /capture") return await this.capture(request);
    if (route === "GET /captures") return this.listCaptures();
    if (route === "POST /captures/ack") return await this.ackCaptures(request);
    if (route === "POST /purge") return await this.purge();

    return refuse("not-found", "No such route.");
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

  // -- the merged log ------------------------------------------------------

  private async push(request: Request): Promise<Response> {
    const deviceId = request.headers.get("x-device-id");
    if (deviceId === null) return refuse("unauthorized", "No device.");
    const body = pushRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Malformed push batch.");

    const sql = this.ctx.storage.sql;
    const now = Date.now();

    for (const thread of body.data.threads ?? []) {
      sql.exec(
        `INSERT INTO thread_meta (thread_id, lane, title, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (thread_id) DO UPDATE SET lane = excluded.lane,
           title = COALESCE(excluded.title, thread_meta.title), updated_at = excluded.updated_at`,
        thread.threadId,
        thread.lane,
        thread.title ?? null,
        now,
      );
    }

    let accepted = 0;
    let duplicates = 0;
    const touchedThreads = new Set<string>();
    for (const event of body.data.events) {
      sql.exec(
        "INSERT OR IGNORE INTO sync_events (thread_id, device_id, device_seq, event, created_at) VALUES (?, ?, ?, ?, ?)",
        event.threadId,
        deviceId,
        event.deviceSeq,
        JSON.stringify(event.event),
        event.createdAt,
      );
      const changed = sql.exec<{ n: number }>("SELECT changes() AS n").one().n;
      if (changed === 1) {
        accepted += 1;
        touchedThreads.add(event.threadId);
      } else {
        duplicates += 1;
      }
    }

    const lastSeq = this.lastSeq();

    if (accepted > 0) {
      // The pusher's own sockets are skipped: it holds what it pushed, and a
      // self-ping would only trigger a pull that returns its own rows.
      this.broadcast({ type: "sync", seq: lastSeq }, (tag) => tag.deviceId !== deviceId);
      for (const threadId of this.desktopLaneThreads(touchedThreads, body.data.threads ?? [])) {
        this.broadcast(
          { type: "dispatch", threadId },
          (tag) => tag.platform === "desktop" && tag.deviceId !== deviceId,
        );
      }
    }

    const response: PushResponse = { accepted, duplicates, lastSeq };
    return Response.json(response);
  }

  /** The dispatch set: threads this push touched (rows OR meta) whose lane is
   * `desktop` — a dispatch is one push carrying the thread and its first
   * events together, and either half alone must still ping. */
  private desktopLaneThreads(
    touched: ReadonlySet<string>,
    metaUpserts: readonly { threadId: string; lane: string }[],
  ): Set<string> {
    const candidates = new Set<string>(touched);
    for (const meta of metaUpserts) {
      if (meta.lane === "desktop") candidates.add(meta.threadId);
    }
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
    if (!body.success) return refuse("bad-request", "Send { text }.");
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO captures (id, text, created_at) VALUES (?, ?, ?)",
      id,
      body.data.text,
      createdAt,
    );
    // Every socket, the capturing device's included: whichever device syncs
    // first applies and acks, and the capturer may well be the only one online.
    this.broadcast({ type: "capture" }, () => true);
    const response: CaptureResponse = { id, createdAt };
    return Response.json(response);
  }

  private listCaptures(): Response {
    const rows = this.ctx.storage.sql
      .exec<{ id: string; text: string; created_at: number }>(
        "SELECT id, text, created_at FROM captures ORDER BY created_at, id LIMIT 500",
      )
      .toArray();
    const response: ListCapturesResponse = {
      captures: rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at })),
    };
    return Response.json(response);
  }

  private async ackCaptures(request: Request): Promise<Response> {
    const body = ackCapturesRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { ids }.");
    const sql = this.ctx.storage.sql;
    let deleted = 0;
    for (const id of body.data.ids) {
      sql.exec("DELETE FROM captures WHERE id = ?", id);
      deleted += sql.exec<{ n: number }>("SELECT changes() AS n").one().n;
    }
    const response: AckCapturesResponse = { deleted };
    return Response.json(response);
  }

  // -- account deletion ----------------------------------------------------

  /** Drop everything this object holds. Sockets first (a purged account has no
   * live-follow), then the storage whole; the schema comes back empty for the
   * same instance's next call. Idempotent — the deletion hook may retry. */
  private async purge(): Promise<Response> {
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
    return Response.json({ purged: true });
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
