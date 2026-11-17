// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every client reads. It holds the library's tables, its change sets
// and jobs, and the account's live sockets; its rules are each `cell-*` module's, and every
// transaction over them the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO`, under a name a verified credential or the cell
// itself gave (`./library-cell`); every call is RPC, a client's library call and an assistant's
// with the principal the Worker verified beside the request, and fetch carries only the socket
// upgrade, which no RPC can. Nothing a later event needs is kept in memory but the listing, which
// the first read after a wake builds again from the rows (`./cell-listing`), and the cell sets no
// timer: its one alarm runs the `jobs` table.

import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
} from "@repo/contract/library/library-socket";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { AccountGoneError } from "@repo/contract/rpc/v1-errors";
import { DurableObject } from "cloudflare:workers";

import { landPush, runTurnTool, showPreview } from "../agent/agent-turns";
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
import { projectAnswerSchema } from "../note/note-wire";
import type { NoteOpening, NoteProjection, ProjectAnswer, SeedAnswer } from "../note/note-wire";
import { plainRefusal } from "../wire/rpc-refusal";
import { purgeAccount } from "./account-purge";
import { landArticle } from "./article-landing";
import { reserve, settleStored } from "./cell-blobs";
import type { Settlement, UploadRequest, UploadRoom } from "./cell-blobs";
import { runJobs } from "./cell-alarm";
import { fillWaits, landReading } from "./cell-fills";
import { landProjection, openNote, readSeed, takeSessionNotes } from "./cell-notes";
import type { CellResult } from "./cell-refusal";
import { collectMoved } from "./cell-moved";
import { openWithSchema } from "../object-schema";
import { CELL_SCHEMA } from "./cell-db";
import { acceptSocket, severHolder, SOCKET_HOLDER_HEADER, tellSockets } from "./cell-sockets";
import {
  appPrincipalSchema,
  connectorPrincipalSchema,
  credentialIdSchema,
} from "./library-principal";
import type { AppPrincipal, ConnectorPrincipal, NamedPrincipal } from "./library-principal";
import { serveLibraryRpc } from "./library-rpc";
import { openCell } from "./open-cell";
import type { Cell } from "./open-cell";

// an alarm whose run failed outright tries again after this; a job's own failure waits by its lease
const ALARM_RETRY_MS = 60_000;

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

  // a principal the Worker handed in, held to this cell's own account: only the Worker reaches a
  // cell, and it names one only by the account it verified
  #own<P extends NamedPrincipal>(principal: P): P {
    if (principal.accountId !== this.#cell.accountId) {
      throw new Error("a library cell serves its own account alone");
    }
    return principal;
  }

  // an app's call on `/v1/rpc/library`, by the session the Worker admitted (`../wire/v1-rpc`); the
  // principal is parsed again at this door, as `landFill` parses, since a Worker of another deploy
  // may hand another shape
  async serveLibrary(request: Request, principal: AppPrincipal): Promise<Response> {
    const app = this.#own(appPrincipalSchema.parse(principal));
    const response = await serveLibraryRpc(request, this.#cell.contextFor(app));
    return response ?? new Response("not found", { status: 404 });
  }

  // the connector's MCP handler, built on this cell's first call to it; each request still builds
  // its own server from the handler's factory
  #connector: McpHttpHandler | undefined;

  // an assistant's call on the connector, by the grant the Worker verified
  // (`../connector/connector-route`)
  async serveConnector(request: Request, principal: ConnectorPrincipal): Promise<Response> {
    const assistant = this.#own(connectorPrincipalSchema.parse(principal));
    this.#connector ??= createConnectorHandler((caller) => this.#cell.contextFor(caller));
    return await this.#connector.fetch(request, { authInfo: authInfoOf(assistant) });
  }

  // the one request that stays HTTP, since a socket crosses no RPC: the account socket's upgrade,
  // its session named by the Worker that verified it (`./socket-routes`)
  override fetch(request: Request): Response {
    const sessionId = credentialIdSchema.safeParse(request.headers.get(SOCKET_HOLDER_HEADER));
    if (!sessionId.success || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return plainText(400, "The cell takes only a verified socket upgrade.");
    }
    if (this.#cell.library.deletedAt() !== null) {
      return plainRefusal(new AccountGoneError());
    }
    return acceptSocket(this.ctx, sessionId.data);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketMessage(): void {
    // a frame is no request: a newer app must not lose its socket over one this build predates
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- DurableObject declares this hook as an instance method
  override webSocketError(_socket: WebSocket, cause: unknown): void {
    console.warn({ event: "library-socket-error", ...errorFields(cause) });
  }

  // The jobs due (`./cell-alarm`), on a cell of the run's own, whose writes' frames are told as
  // one when it ends: each job lands in a transaction of its own, and a call landing meanwhile
  // tells its own at once, on the wake's cell. Every commit sets the alarm again, so the run
  // leaves it at the earliest job still waiting
  override async alarm(): Promise<void> {
    const moved = collectMoved();
    const cell = openCell(this.ctx, this.env, { moved: moved.add });
    try {
      await runJobs(cell);
    } catch (error) {
      console.error({ event: "library-alarm-failed", ...errorFields(error) });
      await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
    }
    const frame = moved.frame();
    if (frame !== null) {
      tellSockets(this.ctx, frame);
    }
  }

  // the sockets of a session that ended after their upgrade, the account's and each note's it
  // opened; its next request meets the end itself (`./socket-routes`)
  async sever(sessionId: string): Promise<void> {
    const { library, notes } = this.#cell;
    severHolder(this.ctx, sessionId);
    const opened = library.rows((db) => takeSessionNotes(db, sessionId));
    for (const itemId of opened.ok ? opened.value : []) {
      try {
        await notes(itemId).sever(sessionId);
      } catch (error) {
        console.warn({ event: "note-sever-failed", ...errorFields(error) });
      }
    }
  }

  // ---- what each item's note asks (`../note/note-do`) ----

  // how a session's socket on an item's note opens, asked by the note's door
  openNote(sessionId: string, itemId: string): NoteOpening {
    const opening = this.#cell.library.rows((db) => openNote(db, sessionId, itemId));
    return opening.ok ? opening.value : "missing";
  }

  readSeed(itemId: string): SeedAnswer {
    const seed = this.#cell.library.rows((db) => readSeed(db, itemId));
    return seed.ok ? seed.value : { kind: "missing" };
  }

  // a note's save, joining no change set, since typing is no change Undo takes back; `gone` once
  // the account's deletion began, so the note stops pushing
  projectNote(itemId: string, projection: NoteProjection): ProjectAnswer {
    const landed = this.#cell.library.landApart(
      { answer: projectAnswerSchema, opId: undefined },
      (scope) => landProjection(scope, itemId, projection),
    );
    return landed.ok ? landed.value : "gone";
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
    return reserve(this.#cell.library, request);
  }

  // the file's row once its upload is in R2, at the size R2 holds (`settleStored`)
  async settleBlob(sha: string): Promise<CellResult<Settlement>> {
    const { accountId, library } = this.#cell;
    return await settleStored(this.env, accountId, library, sha);
  }

  // whether the item still waits for the cloud's reading of `url`, asked before the page is read
  fillWanted(itemId: string, url: string): CellResult<boolean> {
    return this.#cell.library.read((db) => fillWaits(db, itemId, url));
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
    return await landArticle(notes, reading.kind === "read" ? reading.article : [], (inNote) =>
      landReading(library, reading, inNote?.projection ?? null),
    );
  }
}
