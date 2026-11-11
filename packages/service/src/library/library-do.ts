// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every client reads. It holds the library's tables, its change sets
// and jobs, and the account's live sockets; its rules are the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO`, under a name a verified credential or the cell
// itself gave (`./library-cell`); fetch carries what stays a request and its response, a client's
// library call and the socket upgrade, and every other call is RPC. Nothing a later event needs is
// kept in memory but the listing, which the first read after a wake builds again from the rows
// (`./cell-listing`), and the cell sets no timer: its one alarm runs the `jobs` table.

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
  ToolAnswer,
  ToolRequest,
} from "../agent/thread-wire";
import { plainText } from "../plain-http";
import { authInfoOf, createConnectorHandler } from "../connector/connector-server";
import { fillLandingSchema } from "../fill/fill-landing";
import type { FillLanded, FillLanding } from "../fill/fill-landing";
import { errorFields } from "../log";
import { noteStub } from "../note/note-stub";
import type {
  NoteOpening,
  NoteProjection,
  NoteReach,
  ProjectAnswer,
  SeedAnswer,
} from "../note/note-wire";
import { purgeAccount } from "./account-purge";
import { articleThenLand } from "./article-landing";
import type { UploadRequest, UploadRoom } from "./cell-blobs";
import { fillForNote } from "./cell-fills";
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
import { holdListing } from "./cell-listing";
import { EVERYTHING_MOVED } from "./cell-moved";
import { openWithSchema } from "../object-schema";
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
    openWithSchema(ctx, "library-cell", migrateCell);
  }

  get #accountId(): string {
    return cellAccountId(this.ctx.id.name);
  }

  // each item's note, which this cell alone names for the items its rows hold
  readonly #notes: NoteReach = (itemId) =>
    noteStub(this.ctx.exports, { accountId: this.#accountId, itemId });

  readonly #listing = holdListing();

  // the engine over this cell's storage, with the listing this wake holds
  #library(): LibraryEngine {
    return openCellLibrary(this.ctx, this.env, this.#listing);
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
  #cellContext(principal: Principal, library = this.#library()): CellContext {
    return {
      actor: LibraryDO.#actorOf(principal, library),
      agent: this.#agentCell(library),
      library,
      notes: this.#notes,
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
    if (this.#library().deletedAt() !== null) {
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
    const library = this.#library();
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
      await this.#purgeNotes(library);
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

  // the purged items' notes, emptied between two transactions; one that fails waits its turn again
  async #purgeNotes(library: LibraryEngine): Promise<void> {
    for (const purge of library.claimNotePurges()) {
      try {
        await this.#notes(purge.itemId).purge();
        library.notePurged(purge, true);
      } catch (error) {
        logJobFailure(purge.job, error);
        library.notePurged(purge, false);
      }
    }
  }

  // the sockets of a holder whose session ended after its upgrade, the account's and each note's
  // it opened; its next request meets the end itself (`./socket-routes`)
  async sever(holder: SocketHolder): Promise<void> {
    severHolder(this.ctx, holder);
    for (const itemId of this.#library().sessionNotes(holder.id)) {
      try {
        await this.#notes(itemId).sever(holder.id);
      } catch (error) {
        console.warn({ event: "note-sever-failed", ...errorFields(error) });
      }
    }
  }

  // ---- what each item's note asks (`../note/note-do`) ----

  // how a session's socket on an item's note opens, asked by the note's door
  openNote(sessionId: string, itemId: string): NoteOpening {
    return this.#library().noteOpening(sessionId, itemId);
  }

  readSeed(itemId: string): SeedAnswer {
    return this.#library().seedFor(itemId);
  }

  confirmSeed(itemId: string): void {
    this.#library().seedTaken(itemId);
  }

  // a note's save; `gone` once the account's deletion began, so the note stops pushing
  async projectNote(itemId: string, projection: NoteProjection): Promise<ProjectAnswer> {
    const library = this.#library();
    const result = await settleCommit(
      this.ctx,
      this.env,
      library,
      library.projectNote(itemId, projection),
    );
    return result.ok ? result.value : "gone";
  }

  // the account's deletion, every step in order (`./account-purge`)
  async purge(email: string): Promise<void> {
    await purgeAccount({ accountId: this.#accountId, ctx: this.ctx, email, env: this.env });
  }

  // ---- what a conversation's object asks (`../agent/thread-loop`) ----

  // one tool call of an open turn, run as that turn's
  async agentTool(request: ToolRequest): Promise<CellAnswer<ToolAnswer>> {
    return await runTurnTool(this.#agentCell(this.#library()), request);
  }

  // what a turn did, landed once by its sequence
  async agentPush(request: PushRequest): Promise<CellAnswer<null>> {
    return await landPush(this.#agentCell(this.#library()), request);
  }

  // the reply as it is written, on the sockets alone
  agentPreview(request: PreviewRequest): CellAnswer<null> {
    return showPreview(this.#agentCell(this.#library()), request);
  }

  // room for a file a device is about to upload to `/v1/blobs/<sha>`
  async reserveBlob(request: UploadRequest): Promise<CellResult<UploadRoom>> {
    const library = this.#library();
    return await settleCommit(this.ctx, this.env, library, library.reserve(request));
  }

  // the file's row once its upload is in R2, at the size R2 holds (`settleStored`)
  async settleBlob(sha: string): Promise<CellResult<UploadSettlement>> {
    const library = this.#library();
    return await settleCommit(
      this.ctx,
      this.env,
      library,
      await settleStored(this.env, this.#accountId, library, sha),
    );
  }

  // whether the item still waits for the cloud's reading of `url`, asked before the page is read
  fillWanted(itemId: string, url: string): CellResult<boolean> {
    return this.#library().fillWanted(itemId, url);
  }

  // a page the fill queue's consumer read (`../fill/fill-consumer`), parsed again at this door,
  // since a consumer of another deploy may send another shape, which lands nothing
  async landFill(landing: FillLanding): Promise<CellResult<FillLanded>> {
    const parsed = fillLandingSchema.safeParse(landing);
    if (!parsed.success) {
      console.error({ event: "fill-landing-malformed", issues: parsed.error.issues.length });
      return { moved: null, ok: true, value: { kind: "stale" } };
    }
    const library = this.#library();
    const reading = parsed.data;
    const landed = await articleThenLand(this.#notes, {
      land: (inNote) => library.landReading(reading, inNote?.projection ?? null),
      target: () => {
        const target = library.read((storage) => fillForNote(storage, reading));
        return target.ok ? target.value : null;
      },
    });
    return await settleCommit(this.ctx, this.env, library, landed);
  }
}
