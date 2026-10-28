// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every replica pulls from. It holds the library's tables, its history and
// jobs, and the account's live sockets; its rules are the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO` under a name only a verified credential gives
// (`./library-cell`); fetch carries what stays a request and its response, a client's library call
// and the socket upgrade, and every other call is RPC. Nothing a later event needs is kept in
// memory, and the cell sets no timer: its one alarm runs the `jobs` table.

import { SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG } from "@repo/contract/cloud/sync/sync-ws";
import { DurableObject } from "cloudflare:workers";

import { refuse } from "../cloud-http";
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
} from "./cell-sockets";
import { cellAccountId } from "./library-cell";
import { PRINCIPAL_HEADER, principalFromHeader } from "./library-principal";
import { serveLibraryRpc, V1_LIBRARY_RPC_PATH } from "./library-rpc";
import type { UploadSettlement } from "./library-engine";

// an alarm whose run failed outright tries again after this; a job's own failure waits longer
const ALARM_RETRY_MS = 60_000;

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

  // the two requests that stay HTTP: a library call on `/v1/rpc/library` with its principal, and
  // the socket upgrade with its holder, each stamped by the Worker that verified it
  // (`../wire/v1-rpc`, `./socket-routes`)
  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    return pathname.startsWith(`${V1_LIBRARY_RPC_PATH}/`)
      ? await this.#serveRpc(request)
      : this.#acceptSocket(request);
  }

  async #serveRpc(request: Request): Promise<Response> {
    const principal = principalFromHeader(request.headers.get(PRINCIPAL_HEADER));
    // only the Worker reaches a cell, and it names one only by the account it verified
    if (principal?.accountId !== this.#accountId) {
      return new Response("The cell takes only a call the Worker verified.", { status: 403 });
    }
    const library = openCellLibrary(this.ctx, this.env);
    const response = await serveLibraryRpc(request, {
      library,
      principal,
      settle: async (result) => await settleCommit(this.ctx, this.env, library, result),
    });
    return response ?? new Response("not found", { status: 404 });
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

  // the jobs due: the storage's own, then those that wait on R2 (strays, imports, exports) and
  // the readings to send; whatever moved the library is told to the sockets once
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
    await purgeAccount({ accountId: this.#accountId, ctx: this.ctx, email, env: this.env });
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
