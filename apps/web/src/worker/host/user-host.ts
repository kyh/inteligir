import { DurableObject } from "cloudflare:workers";

import {
  binaryChannelFor,
  binaryChannelForTag,
  HYDRATED_EVENTS,
  type EventMethod,
} from "@repo/bridge/ipc-registry";
import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  WS_CLOSE_UNAUTHORIZED,
  type ReqFrame,
  type SendFrame,
} from "@repo/bridge/ws-protocol";

import { composeAgent, type AgentComposition } from "../agent/agent-composition";
import { isOAuthCallbackPath, matchAgentReportPath } from "../agent/agent-route";
import { providerSettings } from "../agent/provider-catalog";
import { TextGenerator } from "../ai/text-generator";
import { CaptureInbox } from "../capture/capture-inbox";
import { CaptureService } from "../capture/capture-service";
import { handleDeepLink } from "../capture/deep-link-route";
import { composeVoice, type VoiceComposition } from "../voice/voice-composition";
import { handleAgentReport, handleOAuthCallback } from "./agent-endpoints";
import { logUnhandled, logUnhandledCallback } from "../log";
import { handleAssetUpload } from "./asset-route";
import { mayInvoke, mayReceive } from "./client-class";
import { collectHandlers, type WireHandler } from "./handler-registry";
import { cloudAppState, registerCloudHandlers } from "./handlers";
import { HostEvents } from "./host-events";
import { HostLimits } from "./host-limits";
import { purgeR2Prefix } from "./vault/r2-prefix";
import { handleVaultExport } from "./vault-export";
import { INDEX_CONTINUATION_MS, UserKnowledge } from "./knowledge/user-knowledge";
import { userIdFromHostName } from "./host-address";
import { matchHostLeaf, type HostLeaf } from "./host-route";
import { SocketTickets } from "./socket-ticket";
import { handleTicketMint } from "./ticket-route";
import {
  authedState,
  pendingState,
  readSocketState,
  writeSocketState,
  type AuthedSocketState,
  type PendingSocketState,
} from "./socket-state";
import { createCloudStores, type CloudStores } from "./stores";
import { resolveDailyNotePath } from "./daily-note";
import { SEED_OPEN_NOTE, seedVault } from "./vault/seed";
import { UserVault, VAULT_ROOT } from "./vault/user-vault";
import type { DurableKv } from "../store/durable-kv";

// ---------------------------------------------------------------------------
// UserHost — one Durable Object per user, serving that user's Bridge (every
// host method and event channel the registry declares) over ONE hibernatable
// WebSocket per client. Addressed `env.UserHost.getByName("user:" + userId)`,
// with the userId derived from the caller's credential rather than their URL.
//
// HIBERNATION IS THE POINT. Sockets are accepted with `ctx.acceptWebSocket`
// and served through the `webSocket*` handler methods rather than
// `addEventListener`, so an idle host with open sockets is evicted from memory
// and accrues no duration billing. The consequence runs through every design
// decision below: NO in-memory field may hold anything a later message needs.
// Per-socket identity lives in the socket's own attachment, and the broadcast
// set is rebuilt from `ctx.getWebSockets()` on every push instead of being
// tracked in a Map.
//
// AUTH is a first frame, not the handshake, and what it carries is a TICKET
// (./socket-ticket) rather than a session. A browser cannot set an
// Authorization header on `new WebSocket()`, and the two alternatives are
// worse: a credential in the query string lands in every request log, and the
// cookie that rides the handshake is attached cross-origin too, so a socket
// admitted on it alone would be forgeable from any page the browser has open.
// The ticket answers all of it — this object minted it, for one socket, for one
// minute, and spending it is a synchronous read of this object's own SQLite
// with no session round trip on the wake path.
//
// The URL carries NO userId. The Worker derives the object name from the
// caller's own credential (./host-route), so naming an object is not something
// a request can do — and an object nobody can name serves nobody.
// ---------------------------------------------------------------------------

/**
 * How long a socket may sit unauthenticated. Enforced by a DO ALARM, not a
 * `setTimeout`: a pending timer pins the object in memory, which is exactly
 * the hibernation the transport exists to get. The alarm survives eviction,
 * so a socket that connects and then says nothing at all is still reaped —
 * which a "check it on the first message" deadline would never do, that being
 * the one client this bound exists for.
 */
const AUTH_DEADLINE_MS = 10_000;

/** Sockets allowed to sit unauthenticated at once. An `auth` frame follows the
 * handshake immediately, so a queue of pending sockets is not a real client. */
const PRE_AUTH_MAX_SOCKETS = 8;

/** An `auth` frame is ~100 bytes. Anything larger is not something worth
 * parsing on behalf of a caller who has not identified themselves. */
const PRE_AUTH_MAX_FRAME_CHARS = 4096;

/** Immutable at accept time, so only facts already settled belong here — which
 * is precisely why the auth state does not. It marks the wire protocol this
 * socket speaks, so a second frame vocabulary can enumerate its predecessors. */
const SOCKET_TAG_V1 = "v1";

/** Where the last authenticated socket's origin is kept — the OAuth redirect
 * URI's fallback when no public host is declared. */
const LAST_ORIGIN_KEY = "host/last-origin";

// RFC 6455 close codes used below; the 44xx application codes live in
// ws-protocol beside the frames they refuse.
const WS_CLOSE_NORMAL = 1000;
const WS_CLOSE_ABNORMAL = 1006;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
const WS_CLOSE_INTERNAL_ERROR = 1011;
const WS_CLOSE_SERVICE_RESTART = 1012;

export class UserHost extends DurableObject<Env> {
  /** Per-INSTANCE, never module scope: one isolate serves many tenants' hosts
   * (see ./host-events). */
  private readonly events = new HostEvents();

  // ---- the composition ----------------------------------------------------
  //
  // THE RPC SURFACE IS `fetch`, `mintProviderAccessToken` AND `purgeAccount`,
  // and nothing else.
  // Every field below is this object's own composition; it is `readonly` and
  // public for exactly one reason, stated here rather than seven times: a
  // `runInDurableObject` test runs INSIDE the object and drives the real vault,
  // index and agent through them — including the verbs no Bridge channel spells
  // yet (the deletion gate's confirmation, the trash view, the lane bounds).
  //
  // So they are a TEST SEAM, not an interface. Reaching one across a stub would
  // be a second way into this object that skips `fetch`'s admission entirely,
  // and there is no such caller: `env.UserHost.getByName(…)` is dialled in
  // exactly three places, and all three call `fetch` or mint a credential.

  /** This user's vault: the manifest in this object's own SQLite, the bytes in
   * R2 under this object's name (see ./vault/user-vault). */
  readonly vault: UserVault;

  /** The link/search index over that vault (see ./knowledge/user-knowledge). */
  readonly knowledge: UserKnowledge;

  /** Set when a mutation may have created a deadline; consumed by `refreshAlarm`
   * at the end of the inbound path. In memory only, and never read across
   * one — it is set and cleared inside a single invocation. */
  private alarmDirty = false;

  /** Set by `purgeAccount`. Every entry point refuses while it holds, because
   * this instance's handles outlive the storage the purge dropped. */
  private purged = false;

  /**
   * The one flat dispatch map.
   *
   * NOTHING outside `resolveHandler()` may read it, and nothing outside
   * `sendEvent()` may push an event frame. Those two methods are the ONLY
   * places the capability class is consulted, because scattering the check is
   * how it gets forgotten — and a forgotten check fails OPEN. Every path that
   * re-implements "look up a handler" or "write to a socket" — the hydration
   * push, event broadcast, binary frames — is a hole.
   * `__tests__/no-ungated-dispatch.test.ts` fails the build if a new caller
   * reaches around either chokepoint.
   */
  private readonly dispatch: ReadonlyMap<string, WireHandler>;

  /** The agent, and the container it drives (see ../agent/agent-composition).
   * The one thing that DOES leave this object is a minted provider token, and
   * it leaves through `mintProviderAccessToken` below rather than through
   * here. */
  readonly agent: AgentComposition;

  /** The editor's AI — no-tools text turns, run directly from this object
   * rather than through the container (see ../ai/text-generator for why, and
   * for what an outbound fetch costs an object that would otherwise
   * hibernate). */
  readonly ai: TextGenerator;

  /** Text-to-speech and dictation, per OBJECT — never module scope, because
   * this capability moves note content through a third party (../voice). */
  readonly voice: VoiceComposition;

  /** The deep-link capture inbox and the nav parking over it (../capture). */
  readonly captureInbox: CaptureInbox;
  readonly capture: CaptureService;

  /** The origin the last authenticated socket arrived on, so the OAuth redirect
   * URI has something to fall back to where the deployment declared no public
   * host. Persisted, because the object hibernates between the socket that saw
   * it and the connect that needs it. */
  private readonly kv: DurableKv;

  /** This user's durable host state (./stores). Held because the seed decides
   * which note a brand-new workspace lands on, and that is ui-state. */
  private readonly stores: CloudStores;

  /** Unspent socket tickets (./socket-ticket) — minted for a verified session,
   * spent by the socket it opens. */
  private readonly tickets: SocketTickets;

  /** This account's budgets for the HTTP leaves (./host-limits). */
  private readonly limits: HostLimits;

  /** This object's own R2 prefix — the namespace an account purge sweeps. */
  private readonly prefix: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.kv = ctx.storage.kv;
    // An object addressed by id rather than by name can never authenticate
    // (the bind check compares against `userHostName`), so it can never write
    // — the fallback keeps the prefix total without inventing a second
    // namespace anyone can reach.
    this.prefix = ctx.id.name ?? ctx.id.toString();
    const stores = createCloudStores(ctx.storage.kv);
    this.stores = stores;
    this.tickets = new SocketTickets(ctx.storage.sql);
    this.limits = new HostLimits(ctx.storage.sql);
    this.vault = new UserVault({
      sql: ctx.storage.sql,
      bucket: env.VAULT_FILES,
      prefix: this.prefix,
      onChanged: (change) => {
        // A mutation can create a deadline (a delete arms the retention
        // sweep), so the alarm is re-derived at the end of the inbound path
        // rather than from here — this callback is synchronous and the alarm
        // is storage I/O. The index is told the same way: recording is
        // synchronous, and the projection it implies runs on the way out.
        this.alarmDirty = true;
        this.knowledge.record(change);
        // Every writer moves the agent workspace's revision, so a container
        // that wakes after a browser edit materializes the delta rather than
        // the note it last saw.
        this.agent.revisions.record(change);
        this.events.emit("onVaultChanged", { root: VAULT_ROOT });
      },
    });
    this.knowledge = new UserKnowledge({
      storage: ctx.storage,
      vault: this.vault,
      onUpdated: () => {
        this.events.emit("onKnowledgeUpdated", {});
      },
    });
    this.agent = composeAgent({
      env,
      // An object nobody can name serves nobody: it can never authenticate, so
      // it can never reach a credential. The empty id keeps the composition
      // total without inventing an account.
      userId: userIdFromHostName(ctx.id.name) ?? "",
      sql: ctx.storage.sql,
      kv: ctx.storage.kv,
      bucket: env.VAULT_FILES,
      prefix: this.prefix,
      vault: this.vault,
      knowledge: this.knowledge,
      dailyPath: (now) => resolveDailyNotePath(stores.uiState.read(), now),
      publicOrigin: () => this.publicOrigin(),
      emitAgentEvent: (event) => {
        this.events.emit("onAgentEvent", event);
      },
      emitConfirmation: (request) => {
        this.events.emit("onAgentConfirmationRequested", request);
      },
      emitDelegations: (result) => {
        this.events.emit("onDelegationsUpdated", result);
      },
      emitDelegationStream: (id, text) => {
        this.events.emit("onDelegationStreamed", { id, text });
      },
      emitRoutines: (result) => {
        this.events.emit("onRoutinesUpdated", result);
      },
      emitEditCaptured: (capture) => {
        this.events.emit("onAgentEditCaptured", capture);
      },
      onBusyChanged: () => {
        this.events.emit("onAppState", cloudAppState(this.agent.runner.agentBusy()));
      },
      onDeadlineChanged: () => {
        // A routine's schedule moved, or a background run took the lane and
        // with it a lease to reclaim. Re-derived at the end of the inbound
        // path, like every other deadline this host keeps.
        this.alarmDirty = true;
      },
      defer: (work) => {
        ctx.waitUntil(work);
      },
    });
    this.ai = new TextGenerator({
      env,
      credentials: this.agent.credentials,
      // Bound rather than passed bare: `fetch` on workerd is an unbound global,
      // and a method-shaped reference to it throws on call.
      fetch: (input, init) => fetch(input, init),
      emitDelta: (requestId, delta) => {
        this.events.emit("onAiStreamed", { requestId, delta });
      },
    });
    this.voice = composeVoice({
      env,
      userId: userIdFromHostName(ctx.id.name) ?? "",
      kv: ctx.storage.kv,
      uiState: stores.uiState,
      emitAudio: (pcm) => {
        // A registry-declared binary channel: the transport packs the bytes
        // rather than base64-ing them into JSON (see BINARY_CHANNELS). COPIED
        // out of the reader's chunk, which the stream is free to reuse the
        // moment this returns.
        const audio = new ArrayBuffer(pcm.byteLength);
        new Uint8Array(audio).set(pcm);
        this.events.emit("onTtsAudio", { audio });
      },
      emitTranscript: (transcript) => {
        this.events.emit("onSttTranscript", transcript);
      },
      defer: (work) => {
        ctx.waitUntil(work);
      },
    });
    this.captureInbox = new CaptureInbox({
      kv: ctx.storage.kv,
      vault: this.vault,
      dailyPath: (now) => resolveDailyNotePath(stores.uiState.read(), now),
      onApply: (event) => {
        this.events.emit("onCaptureApply", event);
      },
      now: () => Date.now(),
    });
    this.capture = new CaptureService({
      kv: ctx.storage.kv,
      inbox: this.captureInbox,
      onNav: (event) => {
        this.events.emit("onDeepLinkNav", event);
      },
    });

    const handlers = collectHandlers((handle) => {
      registerCloudHandlers(handle, {
        stores,
        events: this.events,
        vault: this.vault,
        knowledge: this.knowledge,
        agent: {
          env,
          userId: userIdFromHostName(ctx.id.name) ?? "",
          runner: this.agent.runner,
          chat: this.agent.chat,
          credentials: this.agent.credentials,
          origin: () => this.publicOrigin(),
          scripted: this.agent.scripted,
          announce: () => this.announceProviders(),
        },
        background: {
          delegations: this.agent.delegations,
          routines: this.agent.routines,
          snapshots: this.agent.snapshots,
        },
        ai: this.ai,
        voice: this.voice,
        capture: { inbox: this.captureInbox, service: this.capture },
      });
    });
    this.dispatch = new Map(Object.entries(handlers));
    this.events.onAny((method, payload) => {
      this.broadcast(method, payload);
    });
  }

  /**
   * Mint a provider access token for a container that proved it is this
   * account's.
   *
   * RPC, because the egress interceptor runs in the Worker and the sealed
   * refresh token is here. It is the ONLY way a live credential leaves this
   * object, and it never leaves toward the container — the interceptor puts it
   * on a request the container already sent.
   */
  mintProviderAccessToken(
    identity: string,
    providerId: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    if (this.purged) {
      return Promise.resolve({ ok: false, error: "this account no longer exists" });
    }
    return this.agent.runner.mintProviderAccessToken(identity, providerId);
  }

  /**
   * Erase this account: its containers, its R2 bytes, and this object's whole
   * storage. Called by Better Auth's user-deletion path (../auth/auth) BEFORE
   * the D1 rows go.
   *
   * NO CREDENTIAL, and that is not the shortcut it looks like. The routes under
   * `fetch` re-derive a session because a caller off the internet supplies the
   * object name and a forwarded verdict would be forgeable. Nothing off the
   * internet reaches here: no route forwards to this method, so the only caller
   * is code in this Worker, after Better Auth has verified the session and the
   * password. And the NAME is the authorization — purging the object called
   * `user:<id>` erases exactly that account and can reach no other, so there is
   * no verdict to forge and no tenant to cross.
   *
   * IDEMPOTENT, because a deletion that half-failed must be safe to retry: the
   * container teardown accepts an absent container, the R2 sweep is driven by
   * what is actually there, and `deleteAll` on empty storage is a no-op. It
   * runs in that order on purpose — the R2 sweep needs no manifest, so a
   * failure anywhere leaves the D1 rows intact and the user able to ask again.
   */
  async purgeAccount(): Promise<void> {
    // Nothing may arrive on a socket after this: the handlers behind it read
    // tables that are about to stop existing.
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "account deleted");
    }
    await this.agent.destroyContainers();
    await purgeR2Prefix(this.env.VAULT_FILES, this.prefix);
    // Deletes the SQLite tables, the KV keys AND the pending alarm in one
    // atomic operation (compatibility_date is past the change that folded the
    // alarm in), so nothing is left to wake an object with no account.
    await this.ctx.storage.deleteAll();
    // NOT `ctx.abort()`, tempting as it is: aborting would break this very RPC,
    // so the caller would read "the data is gone" as a failure and leave the
    // account behind. The instance stays resident instead, holding constructor
    // handles to tables that no longer exist — which is what this flag is for.
    // In memory only, and correct there: it needs to outlive nothing but the
    // instance, and the next construction builds an ordinary empty object.
    this.purged = true;
  }

  /**
   * Push the provider snapshot to whatever sockets are open.
   *
   * The OAuth round-trip finishes on a REDIRECT — a different tab, arriving as
   * an HTTP request rather than a frame — so the workspace has no other way to
   * learn that the connect it started is over. A deployment that offers no
   * provider at all has nothing to say, and says nothing.
   */
  private announceProviders(): void {
    const snapshot = providerSettings(this.env, this.agent.credentials.selection(), (provider) =>
      this.agent.credentials.connected(provider),
    );
    if (snapshot !== null) this.events.emit("onAiProviderChanged", snapshot);
  }

  /** The origin this deployment is reached on: the declared public host, else
   * the last origin an authenticated socket arrived on. */
  private publicOrigin(): string {
    const declared = this.env.PUBLIC_HOST;
    if (declared !== undefined && declared !== "") return `https://${declared}`;
    const stored = this.kv.get(LAST_ORIGIN_KEY);
    return typeof stored === "string" ? stored : "";
  }

  override async fetch(request: Request): Promise<Response> {
    if (this.purged) return new Response("gone", { status: 410 });
    try {
      // Six ways in, and the split is the transport or the CREDENTIAL, never
      // the capability: the ticket mint (./ticket-route), the Bridge socket,
      // the attachment upload that cannot fit in one of its frames
      // (./asset-route), the deep link that arrives as a navigation rather than
      // a frame (../capture/deep-link-route), the container's report
      // (./agent-endpoints), and the provider's OAuth redirect. The last two
      // carry a token this Worker minted rather than a session, because neither
      // caller has one.
      const pathname = new URL(request.url).pathname;
      const leaf = matchHostLeaf(request.method, pathname);
      if (leaf !== null) return await this.handleLeaf(leaf, request);
      if (matchAgentReportPath(request.method, pathname) !== null) {
        const response = await handleAgentReport(request, this.agent.runner);
        await this.knowledge.flush();
        await this.refreshAlarm();
        return response;
      }
      if (isOAuthCallbackPath(pathname)) {
        return await handleOAuthCallback(request, this.env, this.agent.credentials, () => {
          this.announceProviders();
        });
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      logUnhandled("user-host", request, error);
      return new Response("internal error", { status: 500 });
    }
  }

  private async handleLeaf(leaf: HostLeaf, request: Request): Promise<Response> {
    // Charged BEFORE the leaf runs, and after the Worker proved a session for
    // this exact object — so the budget spent is always the account's own
    // (./host-limits).
    const now = Date.now();
    if (!this.limits.charge(leaf, now)) {
      return new Response("too many requests", {
        status: 429,
        headers: { "retry-after": String(this.limits.retryAfterSeconds(leaf, now)) },
      });
    }
    switch (leaf) {
      case "ticket":
        return await handleTicketMint(request, this.env, this.tickets, this.ctx.id.name);
      case "ws":
        return await this.upgrade(request);
      case "assets": {
        const response = await handleAssetUpload(request, this.env, this.vault, this.ctx.id.name);
        // Project what the upload wrote before answering, so the index is never
        // a message behind the manifest.
        await this.knowledge.flush();
        await this.refreshAlarm();
        return response;
      }
      case "link": {
        const response = await handleDeepLink(request, this.env, this.capture, this.ctx.id.name);
        // A capture may have landed on today's note; the index must not be a
        // message behind the manifest, and the ack deadline it armed is a
        // reason to wake.
        this.alarmDirty = true;
        await this.knowledge.flush();
        await this.refreshAlarm();
        return response;
      }
      case "export":
        return await handleVaultExport(
          request,
          this.env,
          this.vault,
          this.ctx.id.name,
          () => new Date(),
        );
    }
  }

  private async upgrade(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    if (this.pendingSocketCount() >= PRE_AUTH_MAX_SOCKETS) {
      return new Response("too many pending connections", { status: 429 });
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [SOCKET_TAG_V1]);
    const now = Date.now();
    writeSocketState(server, pendingState(now, new URL(request.url).origin));
    await this.armAlarm(now + AUTH_DEADLINE_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- the two chokepoints -------------------------------------------------

  /** THE inbound chokepoint. Every path that runs a handler on a socket's
   * behalf — req, send, binary, and the hydration push — resolves through here,
   * so the class gate cannot be skipped by adding a fourth caller. `forbidden`
   * and `unknown` stay distinct: callers answer a req differently, and
   * conflating them would also change what an unauthorized peer learns. */
  private resolveHandler(
    state: AuthedSocketState,
    method: string,
  ): { ok: true; handler: WireHandler } | { ok: false; reason: "forbidden" | "unknown" } {
    if (!mayInvoke(state.clientClass, method)) return { ok: false, reason: "forbidden" };
    const handler = this.dispatch.get(method);
    if (handler === undefined) return { ok: false, reason: "unknown" };
    return { ok: true, handler };
  }

  /** THE outbound chokepoint for host → client pushes. Broadcast and hydration
   * both land here, so an event can never reach a client the class gate would
   * have withheld it from. `frame` is pre-encoded by the caller because a
   * broadcast encodes once and fans out to many sockets. */
  private sendEvent(
    ws: WebSocket,
    state: AuthedSocketState,
    method: string,
    frame: string | ArrayBufferView,
  ): void {
    if (!mayReceive(state.clientClass, method)) return;
    if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(frame);
  }

  // ---- socket lifecycle ----------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.dispatchMessage(ws, message);
      await this.knowledge.flush();
      await this.refreshAlarm();
    } catch (error) {
      logUnhandledCallback("user-host", "webSocketMessage", error);
      ws.close(WS_CLOSE_INTERNAL_ERROR, "internal error");
    }
  }

  private async dispatchMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = readSocketState(ws);
    if (state === null) {
      // An attachment this build cannot read belongs to another deploy's
      // format. It must never be treated as authenticated, and the client's
      // supervisor reconnects into the current one.
      ws.close(WS_CLOSE_SERVICE_RESTART, "reconnect required");
      return;
    }
    if (state.phase === "pending") {
      await this.handlePreAuth(ws, state, message);
      return;
    }
    if (typeof message !== "string") {
      this.handleBinary(ws, state, message);
      return;
    }
    const frame = parseClientFrame(message);
    if (frame === null) return;
    if (frame.t === "req") {
      await this.handleReq(ws, state, frame);
      return;
    }
    if (frame.t === "send") this.handleSend(state, frame);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Nothing to release: a socket's whole state is its attachment, and the
    // broadcast set is rebuilt per push. The close is echoed only to finish the
    // handshake — 1006 is never sendable, so a peer that vanished is answered
    // as a normal close.
    try {
      ws.close(code === WS_CLOSE_ABNORMAL ? WS_CLOSE_NORMAL : code, reason);
    } catch {
      // The peer already completed the handshake.
    }
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    logUnhandledCallback("user-host", "webSocketError", error);
  }

  /**
   * The object's ONE alarm, serving every deadline this host keeps.
   *
   * A Durable Object has exactly one pending alarm, so a second concern cannot
   * call `setAlarm` for itself — it would silently cancel whatever was already
   * armed. The multiplex is therefore structural rather than conventional:
   * every concern runs its own sweep here, every concern answers `nextDueAt`
   * with when it next needs waking, and the alarm is re-armed at the earliest
   * of them. Adding a third concern is a sweep plus a row in `nextDueAt`.
   *
   * `setAlarm` is confined to this class and to two call sites that both arm at
   * `nextDueAt(now)` — the tail of this method, and `armAlarm` behind
   * `refreshAlarm`. No concern arms for itself; that is the invariant, not the
   * call count.
   */
  override async alarm(): Promise<void> {
    if (this.purged) return;
    const now = Date.now();
    this.reapPendingSockets(now);
    this.tickets.sweep(now);
    await this.vault.sweepTrash(now);
    // A capture whose offer nobody answered lands on today's note HERE — a
    // `setTimeout` would pin the object and die with the eviction this deadline
    // has to survive.
    await this.captureInbox.sweep(now);
    // The unattended half: a routine whose slot has passed fires HERE, on a
    // schedule nobody has to be online to keep.
    await this.agent.sweepBackground(now);
    await this.knowledge.flush();
    const next = this.nextDueAt(Date.now());
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** Close every pending socket past its auth deadline. */
  private reapPendingSockets(now: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state === null || state.phase !== "pending") continue;
      if (state.since + AUTH_DEADLINE_MS <= now) {
        ws.close(WS_CLOSE_UNAUTHORIZED, "authentication deadline elapsed");
      }
    }
  }

  /** When this host next needs waking: the earliest of every concern's own
   * next-due time, or `null` when nothing is pending. */
  private nextDueAt(now: number): number | null {
    const due: number[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state === null || state.phase !== "pending") continue;
      const deadline = state.since + AUTH_DEADLINE_MS;
      if (deadline > now) due.push(deadline);
    }
    const sweep = this.vault.nextSweepAt();
    if (sweep !== null) due.push(sweep);
    const background = this.agent.backgroundDueAt(now);
    if (background !== null) due.push(background);
    const capture = this.captureInbox.nextDueAt();
    if (capture !== null) due.push(capture);
    // An index rebuild too large for one pass finishes on the alarm rather than
    // only as far as the next client message happens to carry it.
    if (this.knowledge.hasPendingWork()) due.push(now + INDEX_CONTINUATION_MS);
    return due.length === 0 ? null : Math.min(...due);
  }

  /** Arm the alarm for `at` unless one is already due sooner. */
  private async armAlarm(at: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > at) await this.ctx.storage.setAlarm(at);
  }

  /** Re-derive the alarm after an inbound path that mutated something, or that
   * left indexing work behind. Skipped entirely when neither happened, so a
   * chatty read-only socket pays no storage read per message. */
  private async refreshAlarm(): Promise<void> {
    if (!this.alarmDirty && !this.knowledge.hasPendingWork()) return;
    this.alarmDirty = false;
    const next = this.nextDueAt(Date.now());
    if (next !== null) await this.armAlarm(next);
  }

  // ---- auth ----------------------------------------------------------------

  private async handlePreAuth(
    ws: WebSocket,
    state: PendingSocketState,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      ws.close(WS_CLOSE_POLICY_VIOLATION, "binary frame before auth");
      return;
    }
    if (message.length > PRE_AUTH_MAX_FRAME_CHARS) {
      ws.close(WS_CLOSE_MESSAGE_TOO_BIG, "pre-auth frame too large");
      return;
    }
    const frame = parseClientFrame(message);
    if (frame === null || frame.t !== "auth") {
      // The FIRST frame must be the auth frame. Anything else — a req a client
      // sent optimistically, a malformed frame — closes rather than waiting:
      // there is no state here worth keeping for a peer that did not say who
      // it is.
      ws.close(WS_CLOSE_UNAUTHORIZED, "not authenticated");
      return;
    }
    // The class comes from the ticket, never from the wire: this object minted
    // it against a verified session under the Origin rules (./client-class),
    // and spending it is atomic, so a second socket presenting the same one is
    // refused.
    const clientClass = this.tickets.consume(frame.ticket, Date.now());
    if (clientClass === null) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "invalid ticket");
      return;
    }
    const admitted = authedState(clientClass, Date.now());
    // A brand-new account lands in a workspace, not an empty one. Seeded HERE
    // rather than at construction because merely NAMING a host instantiates
    // one, and a vault written for a caller who never proved who they are is a
    // vault written for a stranger. Idempotent, so every later connect is one
    // COUNT query.
    //
    // Before this socket is marked authed, so the seed's own change events
    // never arrive ahead of its `welcome` — a client that has not been welcomed
    // has not subscribed to anything yet.
    if (await seedVault(this.vault)) {
      // A seeded vault opens ON something. Written here rather than in the UI
      // because only the writer of those files knows which one is the landing
      // note, and the workspace restores this key on boot like any session.
      this.stores.uiState.update((current) => ({
        ...current,
        [UI_STATE_OPEN_NOTE_KEY]: SEED_OPEN_NOTE,
      }));
    }
    // The origin an AUTHENTICATED socket arrived on — never a pending one, so
    // an unauthenticated caller cannot set the origin a later OAuth redirect
    // URI is built from.
    this.kv.put(LAST_ORIGIN_KEY, state.origin);
    writeSocketState(ws, admitted);
    ws.send(encodeFrame({ t: "welcome" }));
    await this.hydrate(ws, admitted);
  }

  // ---- dispatch ------------------------------------------------------------

  private async handleReq(ws: WebSocket, state: AuthedSocketState, frame: ReqFrame): Promise<void> {
    const resolved = this.resolveHandler(state, frame.method);
    if (!resolved.ok) {
      const error =
        resolved.reason === "forbidden"
          ? `${frame.method} is not available to this client`
          : `${frame.method} is not available on this host`;
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: false, error }));
      return;
    }
    try {
      const result = await resolved.handler(frame.payload);
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: true, result }));
    } catch (error) {
      // Message only — never a stack over the wire.
      ws.send(encodeFrame({ t: "res", id: frame.id, ok: false, error: toErrorMessage(error) }));
    }
  }

  private handleSend(state: AuthedSocketState, frame: SendFrame): void {
    const resolved = this.resolveHandler(state, frame.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(frame.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `send:${frame.method}`, error);
    }
  }

  private handleBinary(ws: WebSocket, state: AuthedSocketState, message: ArrayBuffer): void {
    const decoded = decodeBinaryFrame(message);
    if (decoded === null) return;
    const channel = binaryChannelForTag(decoded.tag);
    if (channel === undefined) {
      ws.close(WS_CLOSE_POLICY_VIOLATION, "unknown binary channel");
      return;
    }
    const resolved = this.resolveHandler(state, channel.method);
    if (!resolved.ok) return;
    try {
      resolved.handler(decoded.payload);
    } catch (error) {
      logUnhandledCallback("user-host", `binary:${channel.method}`, error);
    }
  }

  // ---- events --------------------------------------------------------------

  /**
   * The authenticated sockets, rebuilt from attachments on every call.
   *
   * This is the hibernation contract in one method: a `Map<WebSocket, …>` held
   * across messages reads as EMPTY after the first eviction, so every push
   * would silently reach nobody. Walking `ctx.getWebSockets()` costs a
   * deserialize per socket and cannot be wrong.
   */
  private authedSockets(): Array<{ ws: WebSocket; state: AuthedSocketState }> {
    const open: Array<{ ws: WebSocket; state: AuthedSocketState }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = readSocketState(ws);
      if (state !== null && state.phase === "authed") open.push({ ws, state });
    }
    return open;
  }

  private pendingSocketCount(): number {
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (readSocketState(ws)?.phase === "pending") count += 1;
    }
    return count;
  }

  private broadcast(method: EventMethod, payload: unknown): void {
    // Registry-declared binary channels cross as [tag][bytes] instead of JSON;
    // the client reconstitutes the payload from the same declaration.
    const binary = binaryChannelFor(method);
    if (binary !== undefined) {
      const bytes = "field" in binary && isRecord(payload) ? payload[binary.field] : payload;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return;
      const binaryFrame = encodeBinaryFrame(binary.tag, bytes);
      for (const { ws, state } of this.authedSockets()) {
        this.sendEvent(ws, state, method, binaryFrame);
      }
      return;
    }
    const frame = encodeFrame({ t: "evt", method, payload });
    for (const { ws, state } of this.authedSockets()) this.sendEvent(ws, state, method, frame);
  }

  /**
   * Push current state as evt frames for the registry's HYDRATED_EVENTS, so a
   * client that just connected is never sitting on empty panels.
   *
   * Gated by BOTH chokepoints: the getter must be callable by this client AND
   * the event deliverable to it. A hydration push is a read the client never
   * asked for, so it clears the same bar as asking.
   */
  private async hydrate(ws: WebSocket, state: AuthedSocketState): Promise<void> {
    for (const [event, getter] of Object.entries(HYDRATED_EVENTS)) {
      const resolved = this.resolveHandler(state, getter);
      if (!resolved.ok) continue;
      try {
        const payload = await resolved.handler(undefined);
        this.sendEvent(ws, state, event, encodeFrame({ t: "evt", method: event, payload }));
      } catch {
        // Hydration never breaks the connection it heals.
      }
    }
  }
}
