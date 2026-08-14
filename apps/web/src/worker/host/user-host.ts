import { DurableObject } from "cloudflare:workers";

import { WS_CLOSE_UNAUTHORIZED } from "@repo/bridge/ws-protocol";

import type { AgentComposition } from "../agent/agent-composition";
import { isOAuthCallbackPath, matchAgentReportPath } from "../agent/agent-route";
import type { TextGenerator } from "../ai/text-generator";
import type { CaptureInbox } from "../capture/capture-inbox";
import type { CaptureService } from "../capture/capture-service";
import { handleDeepLink } from "../capture/deep-link-route";
import type { VoiceComposition } from "../voice/voice-composition";
import { handleAgentReport, handleOAuthCallback } from "./agent-endpoints";
import { logUnhandled, logUnhandledCallback } from "../log";
import { handleAssetUpload } from "./asset-route";
import { HostAlarm, type AlarmConcern } from "./host-alarm";
import { composeHost, type HostComposition } from "./host-composition";
import { purgeR2Prefix } from "./vault/r2-prefix";
import { handleVaultExport } from "./vault-export";
import { INDEX_CONTINUATION_MS, type UserKnowledge } from "./knowledge/user-knowledge";
import type { UserVault } from "./vault/user-vault";
import { matchHostLeaf, type HostLeaf } from "./host-route";
import { handleTicketMint } from "./ticket-route";
import { SocketTransport, WS_CLOSE_INTERNAL_ERROR } from "./socket-transport";

// ---------------------------------------------------------------------------
// UserHost — one Durable Object per user, serving that user's Bridge (every
// host method and event channel the registry declares) over ONE hibernatable
// WebSocket per client. Addressed `env.UserHost.getByName("user:" + userId)`,
// with the userId derived from the caller's credential rather than their URL.
//
// This class is the object's ENTRY POINTS and nothing else. Everything they act
// on is composed once in ./host-composition; what a socket may ask and what it
// may be told is ./socket-gate; when this host wakes is ./host-alarm.
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

export class UserHost extends DurableObject<Env> {
  /** This user's whole wiring graph, built in one place (./host-composition). */
  private readonly host: HostComposition;

  // ---- the test seam ------------------------------------------------------
  //
  // THE RPC SURFACE IS `fetch`, `mintProviderAccessToken` AND `purgeAccount`,
  // and nothing else. The fields below only NAME parts of the composition
  // above, and they are public for exactly one reason, stated here rather than
  // seven times: a `runInDurableObject` test runs INSIDE the object and drives
  // the real vault, index and agent through them — including the verbs no
  // Bridge channel spells yet (the deletion gate's confirmation, the trash
  // view, the lane bounds).
  //
  // So they are a TEST SEAM, not an interface. Reaching one across a stub would
  // be a second way into this object that skips `fetch`'s admission entirely,
  // and there is no such caller: `env.UserHost.getByName(…)` is dialled in
  // exactly three places, and all three call `fetch` or mint a credential.

  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly agent: AgentComposition;
  readonly ai: TextGenerator;
  readonly voice: VoiceComposition;
  readonly captureInbox: CaptureInbox;
  readonly capture: CaptureService;

  /** The Bridge socket, whole: accept, authenticate, dispatch, gated push
   * (./socket-transport). */
  private readonly sockets: SocketTransport;

  /** Every deadline this host keeps, multiplexed onto its one alarm
   * (./host-alarm). */
  private readonly alarms: HostAlarm;

  /** Set by `purgeAccount`. Every entry point refuses while it holds, because
   * this instance's handles outlive the storage the purge dropped. */
  private purged = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.host = composeHost({
      env,
      ctx,
      // Both read a field assigned below, lazily — and both are only ever
      // called by something serving a request, which cannot happen until this
      // constructor has returned.
      emit: (method, payload) => {
        this.sockets.broadcast(method, payload);
      },
      onDeadlineChanged: () => this.alarms.markDirty(),
    });
    this.vault = this.host.vault;
    this.knowledge = this.host.knowledge;
    this.agent = this.host.agent;
    this.ai = this.host.ai;
    this.voice = this.host.voice;
    this.captureInbox = this.host.captureInbox;
    this.capture = this.host.capture;
    this.sockets = new SocketTransport({
      ctx,
      handlers: this.host.handlers,
      tickets: this.host.tickets,
      onDeadlineChanged: () => this.alarms.markDirty(),
      // A brand-new account lands in a workspace, not an empty one. Seeded on
      // AUTHENTICATION rather than at construction because merely NAMING a host
      // instantiates one, and a vault written for a caller who never proved who
      // they are is a vault written for a stranger.
      onAuthenticated: async (origin) => {
        await this.host.seedVault();
        this.host.rememberOrigin(origin);
      },
    });
    this.alarms = new HostAlarm({
      storage: ctx.storage,
      now: () => Date.now(),
      concerns: this.alarmConcerns(),
    });
  }

  /**
   * Every deadline this host keeps, in sweep order — the whole answer to "when
   * does this object wake, and what happens when it does".
   *
   * Adding a concern is ONE row. Two halves that have to agree (a sweep here, a
   * due time somewhere else) is how a concern ends up swept but never woken
   * for, or woken for and never swept.
   */
  private alarmConcerns(): readonly AlarmConcern[] {
    const { vault, knowledge, captureInbox, tickets, agent } = this.host;
    return [
      // A socket that connected and then said nothing at all.
      {
        sweep: (now) => this.sockets.reapPending(now),
        dueAt: (now) => this.sockets.nextDeadline(now),
      },
      { sweep: (now) => tickets.sweep(now), dueAt: () => null },
      {
        sweep: async (now) => {
          await vault.sweepTrash(now);
        },
        dueAt: () => vault.nextSweepAt(),
      },
      // A capture whose offer nobody answered lands on today's note HERE.
      { sweep: (now) => captureInbox.sweep(now), dueAt: () => captureInbox.nextDueAt() },
      // The unattended half: a routine whose slot has passed fires HERE, on a
      // schedule nobody has to be online to keep.
      { sweep: (now) => agent.sweepBackground(now), dueAt: (now) => agent.backgroundDueAt(now) },
      // An index rebuild too large for one pass finishes on the alarm rather
      // than only as far as the next client message happens to carry it. Last,
      // so it projects whatever the sweeps above just wrote.
      {
        sweep: () => knowledge.flush(),
        dueAt: (now) => (knowledge.hasPendingWork() ? now + INDEX_CONTINUATION_MS : null),
      },
    ];
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
    return this.host.agent.runner.mintProviderAccessToken(identity, providerId);
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
    this.sockets.closeAll(WS_CLOSE_UNAUTHORIZED, "account deleted");
    await this.host.agent.destroyContainers();
    await purgeR2Prefix(this.env.VAULT_FILES, this.host.prefix);
    // Deletes the SQLite tables, the KV keys AND the pending alarm in one
    // atomic operation (compatibility_date is past the change that folded the
    // alarm in), so nothing is left to wake an object with no account.
    await this.ctx.storage.deleteAll();
    this.alarms.stop();
    // NOT `ctx.abort()`, tempting as it is: aborting would break this very RPC,
    // so the caller would read "the data is gone" as a failure and leave the
    // account behind. The instance stays resident instead, holding constructor
    // handles to tables that no longer exist — which is what this flag is for.
    // In memory only, and correct there: it needs to outlive nothing but the
    // instance, and the next construction builds an ordinary empty object.
    this.purged = true;
  }

  override async fetch(request: Request): Promise<Response> {
    if (this.purged) return new Response("gone", { status: 410 });
    try {
      return await this.route(request);
    } catch (error) {
      logUnhandled("user-host", request, error);
      return new Response("internal error", { status: 500 });
    } finally {
      // On EVERY exit, including the failing one: the dirty flag lives for one
      // invocation, so a path that armed a deadline and then threw would leave
      // it set with no alarm and nothing to re-derive it.
      await this.alarms.refresh();
    }
  }

  private async route(request: Request): Promise<Response> {
    // Six ways in, and the split is the transport or the CREDENTIAL, never the
    // capability: the ticket mint (./ticket-route), the Bridge socket, the
    // attachment upload that cannot fit in one of its frames (./asset-route),
    // the deep link that arrives as a navigation rather than a frame
    // (../capture/deep-link-route), the container's report
    // (./agent-endpoints), and the provider's OAuth redirect. The last two
    // carry a token this Worker minted rather than a session, because neither
    // caller has one.
    const pathname = new URL(request.url).pathname;
    const leaf = matchHostLeaf(request.method, pathname);
    if (leaf !== null) return await this.handleLeaf(leaf, request);
    if (matchAgentReportPath(request.method, pathname) !== null) {
      const response = await handleAgentReport(request, this.host.agent.runner);
      await this.host.knowledge.flush();
      return response;
    }
    if (isOAuthCallbackPath(pathname)) {
      return await handleOAuthCallback(request, this.env, this.host.agent.credentials, () => {
        this.host.announceProviders();
      });
    }
    return new Response("not found", { status: 404 });
  }

  private async handleLeaf(leaf: HostLeaf, request: Request): Promise<Response> {
    // Charged BEFORE the leaf runs, and after the Worker proved a session for
    // this exact object — so the budget spent is always the account's own
    // (./host-limits).
    const now = Date.now();
    const { limits, vault, knowledge, capture, tickets } = this.host;
    if (!limits.charge(leaf, now)) {
      return new Response("too many requests", {
        status: 429,
        headers: { "retry-after": String(limits.retryAfterSeconds(leaf, now)) },
      });
    }
    switch (leaf) {
      case "ticket":
        return await handleTicketMint(request, this.env, tickets, this.ctx.id.name);
      case "ws":
        return this.upgrade(request);
      case "assets": {
        const response = await handleAssetUpload(request, this.env, vault, this.ctx.id.name);
        // Project what the upload wrote before answering, so the index is never
        // a message behind the manifest.
        await knowledge.flush();
        return response;
      }
      case "link": {
        const response = await handleDeepLink(request, this.env, capture, this.ctx.id.name);
        // A capture may have landed on today's note; the index must not be a
        // message behind the manifest, and the ack deadline it armed is a
        // reason to wake.
        this.alarms.markDirty();
        await knowledge.flush();
        return response;
      }
      case "export":
        return await handleVaultExport(
          request,
          this.env,
          vault,
          this.ctx.id.name,
          () => new Date(),
        );
    }
  }

  private upgrade(request: Request): Response {
    return this.sockets.upgrade(request);
  }

  // ---- socket lifecycle ----------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.sockets.message(ws, message);
      await this.host.knowledge.flush();
    } catch (error) {
      logUnhandledCallback("user-host", "webSocketMessage", error);
      ws.close(WS_CLOSE_INTERNAL_ERROR, "internal error");
    } finally {
      // See `fetch`: consumed on every exit, or the flag outlives the
      // invocation that set it and the deadline it stands for is never armed.
      await this.alarms.refresh();
    }
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.sockets.closed(ws, code, reason);
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    logUnhandledCallback("user-host", "webSocketError", error);
  }

  override async alarm(): Promise<void> {
    if (this.purged) return;
    await this.alarms.fire();
  }
}
