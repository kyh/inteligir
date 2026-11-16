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

import { landPush, runAgentJobs, runTurnTool, showPreview } from "../agent/agent-turns";
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
import type { NoteOpening, NoteProjection, ProjectAnswer, SeedAnswer } from "../note/note-wire";
import { purgeAccount } from "./account-purge";
import { articleThenLand } from "./article-landing";
import type { UploadRequest, UploadRoom } from "./cell-blobs";
import { fillForNote } from "./cell-fills";
import { logJobFailure, removeStrays, sendFills, settleStored } from "./cell-library";
import type { CellResult } from "./cell-refusal";
import { runImports } from "./cell-imports";
import { collectMoved } from "./cell-moved";
import { openWithSchema } from "../object-schema";
import { CELL_SCHEMA } from "./cell-db";
import {
  acceptSocket,
  CELL_SOCKET_PATH,
  holderFromHeader,
  severHolder,
  socketHolder,
  tellSockets,
} from "./cell-sockets";
import type { SocketHolder } from "./cell-sockets";
import {
  isAppPrincipal,
  isConnectorPrincipal,
  PRINCIPAL_HEADER,
  principalFromHeader,
  SOCKET_HOLDER_HEADER,
} from "./library-principal";
import type { NamedPrincipal } from "./library-principal";
import { serveLibraryRpc, V1_LIBRARY_RPC_PATH } from "./library-rpc";
import type { UploadSettlement } from "./library-engine";
import { openCell } from "./open-cell";
import type { Cell } from "./open-cell";

// an alarm whose run failed outright tries again after this; a job's own failure waits longer
const ALARM_RETRY_MS = 60_000;

// the purged items' notes, emptied between two transactions; one that fails waits its turn again
const purgeNotes = async ({ library, notes }: Cell): Promise<void> => {
  for (const purge of library.claimNotePurges()) {
    try {
      await notes(purge.itemId).purge();
      library.notePurged(purge, true);
    } catch (error) {
      logJobFailure(purge.job, error);
      library.notePurged(purge, false);
    }
  }
};

export class LibraryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // answered by the runtime without waking a hibernated cell
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(SOCKET_KEEPALIVE_PING, SOCKET_KEEPALIVE_PONG),
    );
    openWithSchema(ctx, CELL_SCHEMA);
  }

  #opened: Cell | undefined;

  // The cell this wake holds (`./open-cell`), opened by the first event that reads it and never
  // in the constructor: its account is the name a caller's stub or a stored alarm carries
  // (https://developers.cloudflare.com/durable-objects/api/id/), which a wake by a socket's frame
  // is not documented to.
  get #cell(): Cell {
    this.#opened ??= openCell(this.ctx, this.env);
    return this.#opened;
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
    return principal?.accountId === this.#cell.accountId ? principal : null;
  }

  async #serveRpc(request: Request): Promise<Response> {
    const principal = this.#principalOf(request);
    if (principal === null || !isAppPrincipal(principal)) {
      return new Response("The cell takes only a call the Worker verified.", { status: 403 });
    }
    const response = await serveLibraryRpc(request, this.#cell.contextFor(principal));
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
    this.#connector ??= createConnectorHandler((caller) => this.#cell.contextFor(caller));
    return await this.#connector.fetch(request, { authInfo: authInfoOf(principal) });
  }

  #acceptSocket(request: Request): Response {
    const holder = holderFromHeader(request.headers.get(SOCKET_HOLDER_HEADER));
    if (holder === null || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return plainText(400, "The cell takes only a verified socket upgrade.");
    }
    if (this.#cell.library.deletedAt() !== null) {
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

  // The jobs due, on a cell of the run's own, whose writes' frames are told as one when it ends: an
  // import's page would tell the sockets a frame an item, and a call landing meanwhile tells its
  // own at once, on the wake's cell. The storage's jobs first, the readings to send ahead of an
  // import's page, which may run ten seconds, then what waits on R2 or another object. Every commit
  // sets the alarm again, so the run leaves it at the earliest job still waiting
  override async alarm(): Promise<void> {
    const moved = collectMoved();
    const cell = openCell(this.ctx, this.env, { moved: moved.add });
    try {
      cell.library.runDueJobs(logJobFailure);
      await sendFills(this.ctx, this.env, cell.library);
      await removeStrays(this.env, cell.accountId, cell.library);
      await runImports(cell);
      await purgeNotes(cell);
      await runAgentJobs(cell);
    } catch (error) {
      console.error({ event: "library-alarm-failed", ...errorFields(error) });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
    }
    const frame = moved.frame();
    if (frame !== null) {
      tellSockets(this.ctx, frame);
    }
  }

  // the sockets of a holder whose session ended after its upgrade, the account's and each note's
  // it opened; its next request meets the end itself (`./socket-routes`)
  async sever(holder: SocketHolder): Promise<void> {
    const { library, notes } = this.#cell;
    severHolder(this.ctx, holder);
    for (const itemId of library.sessionNotes(holder.id)) {
      try {
        await notes(itemId).sever(holder.id);
      } catch (error) {
        console.warn({ event: "note-sever-failed", ...errorFields(error) });
      }
    }
  }

  // ---- what each item's note asks (`../note/note-do`) ----

  // how a session's socket on an item's note opens, asked by the note's door
  openNote(sessionId: string, itemId: string): NoteOpening {
    return this.#cell.library.noteOpening(sessionId, itemId);
  }

  readSeed(itemId: string): SeedAnswer {
    return this.#cell.library.seedFor(itemId);
  }

  confirmSeed(itemId: string): void {
    this.#cell.library.seedTaken(itemId);
  }

  // a note's save; `gone` once the account's deletion began, so the note stops pushing
  projectNote(itemId: string, projection: NoteProjection): ProjectAnswer {
    const result = this.#cell.library.projectNote(itemId, projection);
    return result.ok ? result.value : "gone";
  }

  // the account's deletion, every step in order (`./account-purge`)
  async purge(email: string): Promise<void> {
    await purgeAccount({ cell: this.#cell, ctx: this.ctx, email });
  }

  // ---- what a conversation's object asks (`../agent/thread-loop`) ----

  // one tool call of an open turn, run as that turn's
  async agentTool(request: ToolRequest): Promise<CellAnswer<ToolAnswer>> {
    return await runTurnTool(this.#cell, request);
  }

  // what a turn did, landed once by its sequence
  agentPush(request: PushRequest): CellAnswer<null> {
    return landPush(this.#cell, request);
  }

  // the reply as it is written, on the sockets alone
  agentPreview(request: PreviewRequest): CellAnswer<null> {
    return showPreview(this.#cell, request);
  }

  // room for a file a device is about to upload to `/v1/blobs/<sha>`
  reserveBlob(request: UploadRequest): CellResult<UploadRoom> {
    return this.#cell.library.reserve(request);
  }

  // the file's row once its upload is in R2, at the size R2 holds (`settleStored`)
  async settleBlob(sha: string): Promise<CellResult<UploadSettlement>> {
    const { accountId, library } = this.#cell;
    return await settleStored(this.env, accountId, library, sha);
  }

  // whether the item still waits for the cloud's reading of `url`, asked before the page is read
  fillWanted(itemId: string, url: string): CellResult<boolean> {
    return this.#cell.library.fillWanted(itemId, url);
  }

  // a page the fill queue's consumer read (`../fill/fill-consumer`), parsed again at this door,
  // since a consumer of another deploy may send another shape, which lands nothing
  async landFill(landing: FillLanding): Promise<CellResult<FillLanded>> {
    const parsed = fillLandingSchema.safeParse(landing);
    if (!parsed.success) {
      console.error({ event: "fill-landing-malformed", issues: parsed.error.issues.length });
      return { ok: true, value: { kind: "stale" } };
    }
    const { library, notes } = this.#cell;
    const reading = parsed.data;
    return await articleThenLand(notes, {
      land: (inNote) => library.landReading(reading, inNote?.projection ?? null),
      target: () => {
        const target = library.read((db) => fillForNote(db, reading));
        return target.ok ? target.value : null;
      },
    });
  }
}
