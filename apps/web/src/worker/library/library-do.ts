// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every replica pulls from. It holds the library's tables, its history and
// jobs, and the account's live sockets; its rules are the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO` under a name only a verified credential gives
// (`./library-cell`); fetch carries what stays a request and its response, a client's library call
// and the socket upgrade, and every other call is RPC. Nothing a later event needs is kept in
// memory, and the cell sets no timer: its one alarm runs the `jobs` table.

import { SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG } from "@repo/contract/cloud/sync/sync-ws";
import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { repairAgentAccess, runAgentJobs } from "../agent/agent-access";
import type { AgentCell, AgentRepair, TurnDriver } from "../agent/agent-access";
import type { WebhookAsk } from "../agent/anthropic-webhook";
import { reconcileTurn, runTurnJobs } from "../agent/agent-turns";
import { openTurn, turnActor } from "../agent/turn-rows";
import { managedAgents } from "../agent/managed-agents";
import type { ManagedAgents } from "../agent/managed-agents";
import { refuse } from "../cloud-http";
import { authInfoOf, createConnectorHandler } from "../connector/connector-server";
import { fillLandingSchema } from "../fill/fill-landing";
import type { FillLanded, FillLanding } from "../fill/fill-landing";
import { errorFields } from "../log";
import { purgeAccount } from "./account-purge";
import type { UploadRequest, UploadRoom } from "./cell-blobs";
import {
  logJobFailure,
  openCellLibrary,
  removeStrays,
  scheduleAlarm,
  sendFills,
  settleCommit,
  settleStored,
} from "./cell-library";
import type { CellResult } from "./cell-refusal";
import { runExports } from "./cell-exports";
import { runImports } from "./cell-imports";
import { openCellSchema } from "./cell-schema";
import {
  acceptSocket,
  holderFromHeader,
  pingLibraryMoved,
  pingVaultMoved,
  severHolder,
  SOCKET_HOLDER_HEADER,
  socketHolder,
  tellSockets,
} from "./cell-sockets";
import type { CellActor } from "./cell-actor";
import { cellAccountId } from "./library-cell";
import {
  cellActorOf,
  isAppPrincipal,
  isConnectorPrincipal,
  isNamedPrincipal,
  PRINCIPAL_HEADER,
  principalFromHeader,
} from "./library-principal";
import type { Principal } from "./library-principal";
import type { CellContext } from "./library-router";
import { serveLibraryRpc, V1_LIBRARY_RPC_PATH } from "./library-rpc";
import type { LibraryEngine, UploadSettlement } from "./library-engine";

// an alarm whose run failed outright tries again after this; a job's own failure waits longer
const ALARM_RETRY_MS = 60_000;

const WEBHOOK_SEEN = z.literal(true);

export class LibraryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // answered by the runtime without waking a hibernated cell
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG),
    );
    // the runtime holds every event until this settles; a throw resets the cell, and the next
    // event opens it again
    void ctx.blockConcurrencyWhile(async () => {
      try {
        await openCellSchema(ctx.storage);
      } catch (error) {
        console.error({ event: "library-cell-open-failed", ...errorFields(error) });
        throw error;
      }
    });
  }

  get #accountId(): string {
    return cellAccountId(this.ctx.id.name);
  }

  // the requests that stay HTTP: an app's library call on `/v1/rpc/library` and an assistant's on
  // the connector, each with its principal, and the socket upgrade with its holder, each stamped by
  // the Worker that verified it (`../wire/v1-rpc`, `../connector/connector-route`,
  // `./socket-routes`)
  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(`${V1_LIBRARY_RPC_PATH}/`)) {
      return await this.#serveRpc(request);
    }
    if (pathname === CONNECTOR_PATH) {
      return await this.#serveConnector(request);
    }
    return this.#acceptSocket(request);
  }

  // the principal the Worker stamped, held to this cell's own account: only the Worker reaches a
  // cell, and it names one only by the account it verified
  #principalOf(request: Request): Principal | null {
    const principal = principalFromHeader(request.headers.get(PRINCIPAL_HEADER));
    return principal?.accountId === this.#accountId ? principal : null;
  }

  // this deployment's Managed Agents client, made on the cell's first need of it: the bindings it
  // is made from are the deployment's, the same for the cell's whole life
  #agents: ManagedAgents | null = null;

  #managedAgents(): ManagedAgents | null {
    this.#agents ??= managedAgents(this.env);
    return this.#agents;
  }

  // whether this isolate reads the open turn's stream (`../agent/turn-stream`)
  readonly #driver: TurnDriver = { again: false, driving: false };

  // the built-in agent over the engine: the Managed Agents client, the Worker itself, whose token
  // endpoint its grant is traded at, and what keeps the cell up while a turn's stream is read
  #agentCell(library: LibraryEngine): AgentCell {
    return {
      accountId: this.#accountId,
      agents: this.#managedAgents(),
      driver: this.#driver,
      endpoint: this.ctx.exports.default,
      env: this.env,
      library,
      now: Date.now,
      scheduleAlarm: async () => {
        await scheduleAlarm(this.ctx, library);
      },
      tell: (frame) => {
        tellSockets(this.ctx, frame);
      },
      waitUntil: (work) => {
        this.ctx.waitUntil(work);
      },
    };
  }

  // whom a call's writes are by: what its principal names, or for the built-in agent the turn
  // open as the write lands, which a turn sealed meanwhile refuses
  static #actorOf(principal: Principal, library: LibraryEngine): () => CellActor {
    if (isNamedPrincipal(principal)) {
      const actor = cellActorOf(principal);
      return () => actor;
    }
    return () => {
      const turn = library.read(openTurn);
      if (!turn.ok || turn.value === null) {
        throw new ORPCError("FORBIDDEN", { message: "No turn of the built-in agent is open." });
      }
      return turnActor(turn.value);
    };
  }

  // a call's cell: the engine over this cell's storage, and what follows its commit
  #cellContext(principal: Principal): CellContext {
    const library = openCellLibrary(this.ctx, this.env);
    return {
      actor: LibraryDO.#actorOf(principal, library),
      agent: this.#agentCell(library),
      library,
      settle: async (result) => await settleCommit(this.ctx, this.env, library, result),
    };
  }

  async #serveRpc(request: Request): Promise<Response> {
    const principal = this.#principalOf(request);
    if (principal === null || !isAppPrincipal(principal)) {
      return new Response("The cell takes only a call the Worker verified.", { status: 403 });
    }
    const response = await serveLibraryRpc(request, this.#cellContext(principal));
    return response ?? new Response("not found", { status: 404 });
  }

  // the connector's MCP handler, built on this cell's first call to it; each request still builds
  // its own server from the handler's factory
  #connector: McpHttpHandler | undefined;

  // an assistant's call, or the built-in agent's while a turn of the account's is open: a call it
  // makes outside a turn is no turn's, so none is taken
  async #serveConnector(request: Request): Promise<Response> {
    const principal = this.#principalOf(request);
    if (principal === null || !isConnectorPrincipal(principal)) {
      return new Response("The cell takes only a call the Worker verified.", { status: 403 });
    }
    if (principal.actor.kind === "agent") {
      const turn = openCellLibrary(this.ctx, this.env).read(openTurn);
      if (!turn.ok || turn.value === null) {
        return new Response("No turn of the built-in agent is open.", { status: 403 });
      }
    }
    this.#connector ??= createConnectorHandler((caller) => this.#cellContext(caller));
    return await this.#connector.fetch(request, { authInfo: authInfoOf(principal) });
  }

  #acceptSocket(request: Request): Response {
    const holder = holderFromHeader(request.headers.get(SOCKET_HOLDER_HEADER));
    if (holder === null || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return refuse("bad-request", "The cell takes only a verified socket upgrade.");
    }
    if (openCellLibrary(this.ctx, this.env).deletedAt() !== null) {
      return refuse("account-deleted", "This account was deleted.");
    }
    return acceptSocket(this.ctx, holder);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketMessage(): void {
    // a frame is no request: a newer app must not lose its socket over one this build predates
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketError(socket: WebSocket, cause: unknown): void {
    console.warn({
      event: "library-socket-error",
      holder: socketHolder(socket)?.kind ?? null,
      ...errorFields(cause),
    });
  }

  // the jobs due: the storage's own, then those that wait on R2 (strays, imports, exports), the
  // readings to send, the agent's access to take down or repair, and its turn's; whatever moved
  // the library is told to the sockets once
  override async alarm(): Promise<void> {
    const library = openCellLibrary(this.ctx, this.env);
    const head = library.head();
    try {
      library.runDueJobs(logJobFailure);
      await removeStrays(this.env, this.#accountId, library);
      const host = {
        accountId: this.#accountId,
        durable: async () => {
          await this.ctx.storage.sync();
        },
        env: this.env,
        library,
        now: Date.now,
      };
      await runImports(host);
      await runExports(host);
      await sendFills(this.ctx, this.env, library);
      await runAgentJobs(this.#agentCell(library));
      await runTurnJobs(this.#agentCell(library));
      const moved = library.head();
      if (moved !== head) {
        pingLibraryMoved(this.ctx, moved);
      }
      await scheduleAlarm(this.ctx, library);
    } catch (error) {
      console.error({ event: "library-alarm-failed", ...errorFields(error) });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
    }
  }

  // the hosted vault moved: today's apps read this frame, the pushing device's own sockets aside
  vaultMoved(pushingDeviceId: string): void {
    pingVaultMoved(this.ctx, pushingDeviceId);
  }

  // a revoked device's sockets close; its next request meets the revocation itself
  severDevice(deviceId: string): void {
    severHolder(this.ctx, { id: deviceId, kind: "device" });
  }

  // the account's deletion, every step in order (`./account-purge`)
  async purge(email: string): Promise<void> {
    await purgeAccount({
      accountId: this.#accountId,
      agents: this.#managedAgents(),
      ctx: this.ctx,
      email,
      env: this.env,
    });
  }

  // Anthropic said the built-in agent's credential failed: a session's
  // `mcp_authentication_failed_error`, or the `vault_credential.refresh_failed` webhook
  async repairAgentAccess(): Promise<AgentRepair> {
    const library = openCellLibrary(this.ctx, this.env);
    const repaired = await repairAgentAccess(this.#agentCell(library));
    await scheduleAlarm(this.ctx, library);
    return repaired;
  }

  // Anthropic's webhook, once a delivery: a session of the account's idled or ended, and its open
  // turn is reconciled, or the agent's credential could not be refreshed, and it is repaired. The
  // delivery's id is kept as a write's would be, so a delivery Anthropic sends again routes nothing
  async agentWebhook(eventId: string, ask: WebhookAsk): Promise<void> {
    const library = openCellLibrary(this.ctx, this.env);
    const delivery = `anthropic-webhook:${eventId}`;
    const prior = library.answered(delivery, WEBHOOK_SEEN);
    if (!prior.ok || prior.value !== null) {
      return;
    }
    const cell = this.#agentCell(library);
    await (ask === "reconcile" ? reconcileTurn(cell) : repairAgentAccess(cell));
    library.landApart({ answer: WEBHOOK_SEEN, opId: delivery }, () => true as const);
    await scheduleAlarm(this.ctx, library);
  }

  // room for a file a device is about to upload to `/v1/blobs/<sha>`
  async reserveBlob(request: UploadRequest): Promise<CellResult<UploadRoom>> {
    const library = openCellLibrary(this.ctx, this.env);
    return await settleCommit(this.ctx, this.env, library, library.reserve(request));
  }

  // the file's row once its upload is in R2, at the size R2 holds (`settleStored`)
  async settleBlob(sha: string): Promise<CellResult<UploadSettlement>> {
    const library = openCellLibrary(this.ctx, this.env);
    return await settleCommit(
      this.ctx,
      this.env,
      library,
      await settleStored(this.env, this.#accountId, library, sha),
    );
  }

  // whether the item still waits for the cloud's reading of `url`, asked before the page is read
  fillWanted(itemId: string, url: string): CellResult<boolean> {
    return openCellLibrary(this.ctx, this.env).fillWanted(itemId, url);
  }

  // a page the fill queue's consumer read (`../fill/fill-consumer`), parsed again at this door,
  // since a consumer of another deploy may send another shape, which lands nothing
  async landFill(landing: FillLanding): Promise<CellResult<FillLanded>> {
    const parsed = fillLandingSchema.safeParse(landing);
    if (!parsed.success) {
      console.error({ event: "fill-landing-malformed", issues: parsed.error.issues.length });
      return { head: null, ok: true, value: { kind: "stale" } };
    }
    const library = openCellLibrary(this.ctx, this.env);
    return await settleCommit(this.ctx, this.env, library, library.landReading(parsed.data));
  }
}
