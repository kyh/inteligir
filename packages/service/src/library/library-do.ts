// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every client reads. It holds the library's tables, its change sets
// and jobs, and the account's live sockets; its rules are the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO`, under a name a verified credential or the cell
// itself gave (`./library-cell`); fetch carries what stays a request and its response, a client's
// library call and the socket upgrade, and every other call is RPC. Nothing a later event needs is
// kept in memory, and the cell sets no timer: its one alarm runs the `jobs` table.

import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
} from "@repo/contract/library/library-socket";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { DurableObject } from "cloudflare:workers";

import { runAgentTool } from "../agent/agent-tools";
import {
  landPush,
  reserveForCall,
  runAgentJobs,
  runTurnTool,
  showPreview,
  turnActorOf,
} from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import type {
  CellAnswer,
  PreviewRequest,
  PushRequest,
  Reservation,
  ReserveRequest,
  ToolAnswer,
  ToolRequest,
} from "../agent/thread-wire";
import { plainText } from "../plain-http";
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
import { runImports } from "./cell-imports";
import { EVERYTHING_MOVED } from "./cell-moved";
import { migrateCell } from "./cell-db";
import {
  acceptSocket,
  CELL_SOCKET_PATH,
  holderFromHeader,
  severHolder,
  socketHolder,
  tellSockets,
} from "./cell-sockets";
import type { SocketHolder } from "./cell-sockets";
import type { CellActor } from "./cell-actor";
import { cellAccountId } from "./library-cell";
import {
  agentPrincipal,
  cellActorOf,
  isAppPrincipal,
  isConnectorPrincipal,
  isNamedPrincipal,
  PRINCIPAL_HEADER,
  principalFromHeader,
  SOCKET_HOLDER_HEADER,
} from "./library-principal";
import type { NamedPrincipal, Principal } from "./library-principal";
import { libraryRouter } from "./library-router";
import type { CellContext } from "./library-router";
import { serveLibraryRpc, V1_LIBRARY_RPC_PATH } from "./library-rpc";
import type { LibraryEngine, UploadSettlement } from "./library-engine";

// an alarm whose run failed outright tries again after this; a job's own failure waits longer
const ALARM_RETRY_MS = 60_000;

export class LibraryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // answered by the runtime without waking a hibernated cell
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SOCKET_KEEPALIVE_PING, SOCKET_KEEPALIVE_PONG),
    );
    // the runtime holds every event until this settles; a throw resets the cell, and the next
    // event opens it again
    void ctx.blockConcurrencyWhile(async () => {
      try {
        await migrateCell(ctx.storage);
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
    if (pathname === CELL_SOCKET_PATH) {
      return this.#acceptSocket(request);
    }
    return plainText(404, "not found");
  }

  // the principal the Worker stamped, held to this cell's own account: only the Worker reaches a
  // cell, and it names one only by the account it verified
  #principalOf(request: Request): NamedPrincipal | null {
    const principal = principalFromHeader(request.headers.get(PRINCIPAL_HEADER));
    return principal?.accountId === this.#accountId ? principal : null;
  }

  // the built-in agent over the engine: its conversations' objects, the sockets, and every call
  // it runs as one of its turns
  #agentCell(library: LibraryEngine): AgentCell {
    return {
      accountId: this.#accountId,
      env: this.env,
      exports: this.ctx.exports,
      library,
      now: Date.now,
      runTool: async (request) =>
        await runAgentTool(
          libraryRouter,
          this.#cellContext(agentPrincipal(this.#accountId, request), library),
          request,
        ),
      settle: async (result) => await settleCommit(this.ctx, this.env, library, result),
      tell: (frame) => {
        tellSockets(this.ctx, frame);
      },
    };
  }

  // whom a call's writes are by: what its principal names, or for the built-in agent its turn,
  // read again as each write lands, which a turn sealed meanwhile refuses
  static #actorOf(principal: Principal, library: LibraryEngine): () => CellActor {
    if (isNamedPrincipal(principal)) {
      const actor = cellActorOf(principal);
      return () => actor;
    }
    return turnActorOf(library, principal.actor);
  }

  // a call's cell: the engine over this cell's storage, and what follows its commit
  #cellContext(principal: Principal, library = openCellLibrary(this.ctx, this.env)): CellContext {
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

  // an assistant's call
  async #serveConnector(request: Request): Promise<Response> {
    const principal = this.#principalOf(request);
    if (principal === null || !isConnectorPrincipal(principal)) {
      return new Response("The cell takes only a call the Worker verified.", { status: 403 });
    }
    this.#connector ??= createConnectorHandler((caller) => this.#cellContext(caller));
    return await this.#connector.fetch(request, { authInfo: authInfoOf(principal) });
  }

  #acceptSocket(request: Request): Response {
    const holder = holderFromHeader(request.headers.get(SOCKET_HOLDER_HEADER));
    if (holder === null || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return plainText(400, "The cell takes only a verified socket upgrade.");
    }
    if (openCellLibrary(this.ctx, this.env).deletedAt() !== null) {
      return plainText(410, "This account was deleted.");
    }
    return acceptSocket(this.ctx, holder);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketMessage(): void {
    // a frame is no request: a newer app must not lose its socket over one this build predates
  }

  override webSocketError(socket: WebSocket, cause: unknown): void {
    console.warn({
      event: "library-socket-error",
      holder: socketHolder(this.ctx, socket)?.kind ?? null,
      ...errorFields(cause),
    });
  }

  // the jobs due: the storage's own, then those that wait on R2 (strays, imports), the
  // readings to send, and the agent's turns to hand over or ask after; whatever moved the library
  // is told to the sockets once. The agent's writes tell what they moved as each settles, and
  // anything else that moved it, an import's pages above all, says everything moved
  override async alarm(): Promise<void> {
    const library = openCellLibrary(this.ctx, this.env);
    const head = library.head();
    try {
      library.runDueJobs(logJobFailure);
      await removeStrays(this.env, this.#accountId, library);
      await runImports({
        accountId: this.#accountId,
        durable: async () => {
          await this.ctx.storage.sync();
        },
        env: this.env,
        library,
        now: Date.now,
      });
      await sendFills(this.ctx, this.env, library);
      if (library.head() !== head) {
        tellSockets(this.ctx, EVERYTHING_MOVED);
      }
      await runAgentJobs(this.#agentCell(library));
      await scheduleAlarm(this.ctx, library);
    } catch (error) {
      console.error({ event: "library-alarm-failed", ...errorFields(error) });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
    }
  }

  // the sockets of a holder whose session ended after its upgrade; its next request meets the end
  // itself (`./socket-routes`)
  sever(holder: SocketHolder): void {
    severHolder(this.ctx, holder);
  }

  // the account's deletion, every step in order (`./account-purge`)
  async purge(email: string): Promise<void> {
    await purgeAccount({ accountId: this.#accountId, ctx: this.ctx, email, env: this.env });
  }

  // ---- what a conversation's object asks (`../agent/thread-loop`) ----

  // a model call's cap, before it is sent
  agentReserve(request: ReserveRequest): CellAnswer<Reservation> {
    return reserveForCall(this.#agentCell(openCellLibrary(this.ctx, this.env)), request);
  }

  // one tool call of an open turn, run as that turn's
  async agentTool(request: ToolRequest): Promise<CellAnswer<ToolAnswer>> {
    return await runTurnTool(this.#agentCell(openCellLibrary(this.ctx, this.env)), request);
  }

  // what a turn did, landed once by its sequence
  async agentPush(request: PushRequest): Promise<CellAnswer<null>> {
    return await landPush(this.#agentCell(openCellLibrary(this.ctx, this.env)), request);
  }

  // the reply as it is written, on the sockets alone
  agentPreview(request: PreviewRequest): CellAnswer<null> {
    return showPreview(this.#agentCell(openCellLibrary(this.ctx, this.env)), request);
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
      return { moved: null, ok: true, value: { kind: "stale" } };
    }
    const library = openCellLibrary(this.ctx, this.env);
    return await settleCommit(this.ctx, this.env, library, library.landReading(parsed.data));
  }
}
