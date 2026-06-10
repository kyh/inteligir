import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  routePartykitRequest,
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import {
  ChatConversationSchema,
  MAX_MESSAGE_BYTES,
  parseMessage,
  PROTOCOL_VERSION,
  serializeMessage,
  type DispatchMessage,
  type ErrorCode,
  type ParseMessageError,
  type PeerRole,
} from "@repo/dispatch/protocol";
import { hashToken, isValidRoomId } from "@repo/dispatch/pairing";
import { parseConnectionAuth } from "@repo/dispatch/room";

import { getBot, getDiscordAdapter } from "./bot";
import { hasValidEnvVars, type Env } from "./env";
import {
  CLAIM_KEY,
  DEDUPE_PREFIX,
  planSweep,
  ROOM_IDLE_TTL_MS,
  RoomClaimSchema,
  type RoomClaim,
} from "./housekeeping";
import {
  newTokenBucket,
  takeToken,
  type TokenBucketConfig,
  type TokenBucketState,
} from "./token-bucket";

/** Per-connection state set only after connect-time auth succeeds. A refused
 * socket is closed before this is ever written, so `state?.role` doubles as
 * the "is this peer authenticated" check everywhere. */
type ConnState = { role: PeerRole };

/** How long the gateway's inbound POST waits for the desktop to answer before
 * giving up. Must exceed the desktop's per-turn budget (120s) plus its
 * interrupt-drain grace so a slow-but-completing turn still lands inside the
 * window. The desktop processes one chat turn at a time and replies to any
 * message that arrives mid-turn immediately ("busy"), so this only ever covers
 * a single turn — not a queue backlog. */
const REPLY_TIMEOUT_MS = 150_000;

/** Generous per-connection budget: bursts of 256 frames, 64/s sustained — an
 * order of magnitude above a busy streaming transcript. Abuse protection. */
const RATE_LIMIT: TokenBucketConfig = { capacity: 256, refillPerSecond: 64 };

/** DO storage deletes accept at most 128 keys per call. */
const STORAGE_DELETE_BATCH = 128;

/** Bounds on the TTL a dedup caller may request. */
const DEDUPE_MIN_TTL_MS = 1_000;
const DEDUPE_MAX_TTL_MS = 24 * 60 * 60 * 1000;

/** WebSocket close codes: 1000 = normal, 1008 = policy violation (we use it
 * for connect-time refusals, per RFC 6455). */
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY_VIOLATION = 1008;

/** Body of the chat gateway's relay POST, validated at the trust boundary. */
const RelayRequestSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  conversation: Type.Optional(ChatConversationSchema),
});

function assertNever(value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`);
}

/** Map a parse failure onto the wire error catalog. */
function parseErrorToWire(error: ParseMessageError): { code: ErrorCode; message: string } {
  switch (error.code) {
    case "version_mismatch":
      return {
        code: "version_mismatch",
        message: `This relay speaks protocol v${PROTOCOL_VERSION}; upgrade this client.`,
      };
    case "oversized":
      return {
        code: "payload_too_large",
        message: `Frame exceeds ${MAX_MESSAGE_BYTES} bytes.`,
      };
    case "not_text":
    case "invalid_json":
    case "unknown_type":
    case "malformed":
      return { code: "invalid_message", message: `Frame rejected: ${error.code}.` };
  }
}

/**
 * Dispatch relay room (one Durable Object per roomId) — see
 * packages/dispatch/PROTOCOL.md for the full contract. Responsibilities:
 *
 *  - **Connect-time auth** (`onConnect`): role + raw pairing token arrive as
 *    query params; the first authenticated desktop connect claims the room by
 *    storing SHA-256(token); every later connect must hash-match or the
 *    socket is closed. Unauthenticated sockets never enter the room.
 *  - **Dumb relay** (`onMessage`): validated frames are forwarded verbatim to
 *    every other authenticated peer. No message content is ever persisted.
 *  - **Presence**: a snapshot to each connecting peer, `peer_joined` /
 *    `peer_left` deltas to the room — the desktop gates transcript streaming
 *    on an authenticated mobile being present.
 *  - **Chat bridge** (`onRequest`): the gateway POSTs a message and blocks
 *    until the desktop answers with a correlated `chat_reply` (intercepted,
 *    never relayed).
 *  - **Housekeeping** (`onAlarm`): idle-room claim expiry and webhook-dedup
 *    TTL cleanup (the dedup state lives in a dedicated instance of this same
 *    class — see housekeeping.ts).
 */
export class DispatchServer extends Server<Env> {
  /** correlationId -> resolver for an in-flight gateway POST awaiting a reply. */
  private readonly pending = new Map<string, (text: string) => void>();
  /** Per-connection rate-limit buckets (in-memory; reset = refill). */
  private readonly buckets = new Map<string, TokenBucketState>();
  /** Connections currently in a rate-limited episode (one error frame each). */
  private readonly rateLimited = new Set<string>();
  /** Dropped-invalid-frame counter, for observability via logs. */
  private invalidFrameCount = 0;

  override async onConnect(
    connection: Connection<ConnState>,
    ctx: ConnectionContext,
  ): Promise<void> {
    // Room names come from pairing credentials (80-bit CSPRNG). Anything else
    // — including the webhook-dedup instance name — is not connectable.
    if (!isValidRoomId(this.name)) {
      connection.close(CLOSE_POLICY_VIOLATION, "invalid_room");
      return;
    }
    const auth = parseConnectionAuth(new URL(ctx.request.url));
    if (auth === null) {
      connection.close(CLOSE_POLICY_VIOLATION, "unauthorized");
      return;
    }

    const tokenHash = await hashToken(auth.token);
    const claim = await this.readClaim();
    const nowMs = Date.now();
    if (claim === null) {
      // Unclaimed room: only a desktop may claim it. A mobile presenting a
      // token to an unclaimed room is refused — it can't plant a credential.
      if (auth.role !== "desktop") {
        connection.close(CLOSE_POLICY_VIOLATION, "unauthorized");
        return;
      }
      await this.writeClaim({ tokenHash, claimedAt: nowMs, lastSeenAt: nowMs });
    } else {
      if (claim.tokenHash !== tokenHash) {
        connection.close(CLOSE_POLICY_VIOLATION, "unauthorized");
        return;
      }
      await this.writeClaim({ ...claim, lastSeenAt: nowMs });
    }
    await this.ensureAlarmBy(nowMs + ROOM_IDLE_TTL_MS);

    if (auth.role === "desktop") {
      // Newest desktop wins: demote-and-close any stale desktop socket so the
      // chat bridge and relay always target exactly one agent host. State is
      // nulled first so onClose doesn't broadcast a misleading peer_left.
      for (const conn of this.getConnections<ConnState>()) {
        if (conn.id !== connection.id && conn.state?.role === "desktop") {
          conn.setState(null);
          conn.close(CLOSE_NORMAL, "superseded");
        }
      }
    }

    connection.setState({ role: auth.role });

    // Presence snapshot first — clients should treat it as the connection
    // becoming usable and must not send frames before receiving it (frames
    // that race ahead of auth completion are dropped).
    const peers: { role: PeerRole }[] = [];
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.id === connection.id) continue;
      const role = conn.state?.role;
      if (role) peers.push({ role });
    }
    connection.send(serializeMessage({ v: PROTOCOL_VERSION, type: "presence", peers }));
    this.sendToPeers({ v: PROTOCOL_VERSION, type: "peer_joined", role: auth.role }, connection.id);
  }

  override async onMessage(sender: Connection<ConnState>, message: WSMessage): Promise<void> {
    const role = sender.state?.role;
    if (!role) return; // not (yet) authenticated: drop silently

    if (!this.allowFrame(sender)) return;

    if (typeof message !== "string") {
      this.dropInvalid(sender, { code: "not_text" });
      return;
    }
    const parsed = parseMessage(message);
    if (!parsed.ok) {
      this.dropInvalid(sender, parsed.error);
      return;
    }

    const frame = parsed.message;
    switch (frame.type) {
      case "chat_reply": {
        // Resolves the waiting gateway POST. Desktop-only — otherwise a
        // mobile peer could inject attacker-controlled text back into the
        // external messaging platform. Never relayed.
        if (role !== "desktop") {
          this.sendError(sender, "unauthorized", "chat_reply is accepted only from the desktop.");
          return;
        }
        const resolve = this.pending.get(frame.correlationId);
        if (resolve !== undefined) {
          this.pending.delete(frame.correlationId);
          resolve(frame.text);
        }
        return;
      }
      case "room_teardown": {
        if (role !== "desktop") {
          this.sendError(
            sender,
            "unauthorized",
            "room_teardown is accepted only from the desktop.",
          );
          return;
        }
        await this.teardownRoom();
        return;
      }
      case "presence":
      case "peer_joined":
      case "peer_left":
      case "error": {
        this.sendError(sender, "unauthorized", `${frame.type} is server-originated.`);
        return;
      }
      case "user_message":
      case "steer":
      case "interrupt":
      case "agent_event":
      case "chat_message": {
        // Dumb relay: forward the validated frame verbatim (extra fields are
        // tolerated for forward compatibility) to every other authenticated
        // peer. Peers ignore types not addressed to their role.
        this.relayRaw(message, sender.id);
        return;
      }
      default:
        assertNever(frame);
    }
  }

  override async onClose(connection: Connection<ConnState>): Promise<void> {
    this.buckets.delete(connection.id);
    this.rateLimited.delete(connection.id);
    const role = connection.state?.role;
    if (!role) return;
    connection.setState(null); // guard against close+error double-fire
    const claim = await this.readClaim();
    if (claim !== null) {
      await this.writeClaim({ ...claim, lastSeenAt: Date.now() });
    }
    this.sendToPeers({ v: PROTOCOL_VERSION, type: "peer_left", role }, connection.id);
  }

  override onError(connection: Connection<ConnState>): Promise<void> {
    return this.onClose(connection);
  }

  /**
   * Chat gateway bridge: POST `{ text, conversation? }` with a matching
   * `x-relay-secret` header; blocks until the desktop replies (or times out).
   * Reachable internally from bot.ts and externally via
   * /parties/dispatch-server/:room — both require the secret (fail closed:
   * an unset secret means no gateway is authorized).
   */
  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const secret = this.env.CHAT_RELAY_SECRET;
    if (!secret || request.headers.get("x-relay-secret") !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!Value.Check(RelayRequestSchema, body)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    // Only the token-authenticated desktop connection can answer. There is at
    // most one (newest-wins on connect).
    let desktop: Connection<ConnState> | null = null;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.role === "desktop") {
        desktop = conn;
        break;
      }
    }
    if (desktop === null) {
      return Response.json({ error: "no_device" }, { status: 503 });
    }

    const correlationId = crypto.randomUUID();
    desktop.send(
      serializeMessage({
        v: PROTOCOL_VERSION,
        type: "chat_message",
        correlationId,
        text: body.text,
        ...(body.conversation === undefined ? {} : { conversation: body.conversation }),
      }),
    );

    const replyPromise = new Promise<string>((resolve) => {
      this.pending.set(correlationId, resolve);
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    });

    const reply = await Promise.race([replyPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    this.pending.delete(correlationId);

    if (reply === null) return Response.json({ error: "timeout" }, { status: 504 });
    return Response.json({ text: reply });
  }

  /**
   * Cross-isolate webhook dedup, called by bot.ts over DO RPC on the
   * dedicated DEDUPE_INSTANCE_NAME instance (never over HTTP — RPC is
   * unreachable from outside the Worker). Atomically records `key` with a
   * TTL; returns true exactly once per live key. DO input gates make the
   * get→put pair atomic (no event is delivered between awaited storage ops).
   */
  async dedupeSetIfNotExists(key: string, ttlMs: number): Promise<boolean> {
    if (typeof key !== "string" || key.length === 0 || key.length > 512) {
      throw new Error("dedupeSetIfNotExists: invalid key");
    }
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) {
      throw new Error("dedupeSetIfNotExists: invalid ttlMs");
    }
    const ttl = Math.min(Math.max(ttlMs, DEDUPE_MIN_TTL_MS), DEDUPE_MAX_TTL_MS);
    const storageKey = `${DEDUPE_PREFIX}${key}`;
    const existing = await this.ctx.storage.get(storageKey);
    const nowMs = Date.now();
    if (typeof existing === "number" && existing > nowMs) return false;
    const expiresAt = nowMs + ttl;
    await this.ctx.storage.put(storageKey, expiresAt);
    await this.ensureAlarmBy(expiresAt);
    return true;
  }

  override async onAlarm(): Promise<void> {
    const nowMs = Date.now();
    const dedupeEntries = await this.ctx.storage.list({ prefix: DEDUPE_PREFIX });
    const claim = await this.readClaim();
    let hasLiveConnections = false;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.role) {
        hasLiveConnections = true;
        break;
      }
    }

    const plan = planSweep({
      nowMs,
      dedupeEntries,
      claim,
      hasLiveConnections,
      idleTtlMs: ROOM_IDLE_TTL_MS,
    });

    for (let i = 0; i < plan.deleteKeys.length; i += STORAGE_DELETE_BATCH) {
      await this.ctx.storage.delete(plan.deleteKeys.slice(i, i + STORAGE_DELETE_BATCH));
    }
    if (plan.claimAction.kind === "touch" && claim !== null) {
      await this.writeClaim({ ...claim, lastSeenAt: plan.claimAction.lastSeenAt });
    } else if (plan.claimAction.kind === "expire") {
      await this.ctx.storage.delete(CLAIM_KEY);
    }
    if (plan.nextAlarmAtMs !== null) {
      await this.ctx.storage.setAlarm(plan.nextAlarmAtMs);
    }
  }

  // --- helpers -------------------------------------------------------------

  /** Rotate: wipe the credential hash, tell every peer the room is gone,
   * close all sockets. The desktop then claims a fresh room. */
  private async teardownRoom(): Promise<void> {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    const closing = serializeMessage({
      v: PROTOCOL_VERSION,
      type: "error",
      code: "room_closed",
      message: "Room torn down (credential rotated). Re-pair with a fresh pairing string.",
    });
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.role) conn.send(closing);
      conn.setState(null); // suppress peer_left churn during the mass close
      conn.close(CLOSE_NORMAL, "room_closed");
    }
    // In-flight gateway POSTs can no longer be answered; let them time out.
    this.pending.clear();
  }

  /** Token-bucket check. On the first drop of an episode the peer gets one
   * `error{rate_limited}` frame; further drops are silent until it recovers. */
  private allowFrame(conn: Connection<ConnState>): boolean {
    const nowMs = Date.now();
    const prev = this.buckets.get(conn.id) ?? newTokenBucket(RATE_LIMIT, nowMs);
    const { state, allowed } = takeToken(RATE_LIMIT, prev, nowMs);
    this.buckets.set(conn.id, state);
    if (allowed) {
      this.rateLimited.delete(conn.id);
      return true;
    }
    if (!this.rateLimited.has(conn.id)) {
      this.rateLimited.add(conn.id);
      this.sendError(conn, "rate_limited", "Rate limit exceeded; dropping frames until refill.");
    }
    return false;
  }

  /** Drop an invalid frame: count it, answer with a typed error. Bounded by
   * the rate limiter, which runs before parsing. */
  private dropInvalid(conn: Connection<ConnState>, error: ParseMessageError): void {
    this.invalidFrameCount += 1;
    console.warn(`[relay] dropped invalid frame (${error.code}); total=${this.invalidFrameCount}`);
    const wire = parseErrorToWire(error);
    this.sendError(conn, wire.code, wire.message);
  }

  private sendError(conn: Connection<ConnState>, code: ErrorCode, message: string): void {
    conn.send(serializeMessage({ v: PROTOCOL_VERSION, type: "error", code, message }));
  }

  /** Forward a raw, already-validated frame to every other authenticated peer. */
  private relayRaw(raw: string, exceptId: string): void {
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.id !== exceptId && conn.state?.role) conn.send(raw);
    }
  }

  private sendToPeers(message: DispatchMessage, exceptId: string): void {
    this.relayRaw(serializeMessage(message), exceptId);
  }

  private async readClaim(): Promise<RoomClaim | null> {
    const raw = await this.ctx.storage.get(CLAIM_KEY);
    if (raw === undefined) return null;
    if (!Value.Check(RoomClaimSchema, raw)) {
      // Written by an incompatible version: drop it; the desktop re-claims
      // on its next connect. (Mobiles are refused until then — fail closed.)
      await this.ctx.storage.delete(CLAIM_KEY);
      return null;
    }
    return raw;
  }

  private async writeClaim(claim: RoomClaim): Promise<void> {
    await this.ctx.storage.put(CLAIM_KEY, claim);
  }

  /** Make sure the housekeeping alarm fires no later than `atMs`. */
  private async ensureAlarmBy(atMs: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || atMs < current) {
      await this.ctx.storage.setAlarm(atMs);
    }
  }
}

/** Shape of the per-platform webhook handlers exposed by the Chat SDK
 * (the SDK doesn't export its `WebhookHandler` alias). */
type WebhookHandler = (
  request: Request,
  options?: { waitUntil?: (task: Promise<unknown>) => void },
) => Promise<Response>;

export default {
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    if (!hasValidEnvVars(env)) {
      console.error("[server] env bindings failed validation; check wrangler secrets");
      return new Response("Misconfigured", { status: 500 });
    }
    const { pathname } = new URL(request.url);

    // Chat SDK gateway: platform webhooks land here and are bridged to the
    // desktop agent over the dispatch relay (same Worker, same DO class).
    // Only configured platforms have a handler; others 404 rather than throw.
    const webhookMatch = pathname.match(/^\/api\/webhooks\/(slack|telegram|whatsapp|discord)$/);
    const platform = webhookMatch?.[1];
    if (platform !== undefined) {
      const handler: WebhookHandler | undefined = getBot(env).webhooks[platform];
      if (handler === undefined) {
        return new Response(`${platform} adapter not configured`, { status: 404 });
      }
      // The SDK acks the webhook immediately and processes in the background;
      // waitUntil keeps that background turn alive past the ack on Workers.
      return handler(request, { waitUntil: (task) => executionCtx.waitUntil(task) });
    }
    if (pathname === "/api/discord/gateway") {
      return discordGateway(request, env, executionCtx);
    }

    const routed = await routePartykitRequest(request, env, {
      // Cheap pre-DO guards: a garbage room name or an upgrade without
      // role+token query params is refused before a (SQLite-backed) Durable
      // Object is instantiated — random-room probing stays free. Token-hash
      // verification needs DO storage and happens in onConnect.
      onBeforeConnect(req, lobby) {
        if (!isValidRoomId(lobby.name)) return new Response("Invalid room", { status: 403 });
        if (parseConnectionAuth(new URL(req.url)) === null) {
          return new Response("Unauthorized", { status: 401 });
        }
      },
      onBeforeRequest(_req, lobby) {
        if (!isValidRoomId(lobby.name)) return new Response("Invalid room", { status: 403 });
      },
    });
    return routed ?? new Response("Not found", { status: 404 });
  },
};

/**
 * Discord delivers regular messages over a persistent Gateway WebSocket, which
 * Cloudflare Workers can't hold open. This route (meant to be hit by a
 * scheduler, guarded by CRON_SECRET) starts the adapter's gateway listener for
 * the invocation window — see docs for the Cloudflare caveat. Slack / Telegram
 * / WhatsApp are plain webhooks and need none of this.
 */
async function discordGateway(
  request: Request,
  env: Env,
  executionCtx: ExecutionContext,
): Promise<Response> {
  if (!env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const adapter = getDiscordAdapter(env);
  if (adapter === null) {
    return new Response("Discord gateway listener unavailable", { status: 501 });
  }
  const webhookUrl = `https://${new URL(request.url).host}/api/webhooks/discord`;
  return adapter.startGatewayListener(
    { waitUntil: (task) => executionCtx.waitUntil(task) },
    undefined,
    undefined,
    webhookUrl,
  );
}
