// The account's library cell: one SQLite Durable Object per account, the only writer of its
// library and the source every replica pulls from. It holds the library's tables, its history and
// jobs, and the account's live sockets; its rules are the engine's (`./library-engine`). The
// Worker reaches it by `ctx.exports.LibraryDO` under a name only a verified credential gives
// (`./library-cell`); fetch carries the one request that must stay HTTP, the socket upgrade, and
// every other call is RPC. Nothing a later event needs is kept in memory, and the cell sets no
// timer: its one alarm runs the `jobs` table.

import { SYNC_WS_KEEPALIVE_PING, SYNC_WS_KEEPALIVE_PONG } from "@repo/contract/cloud/sync/sync-ws";
import { DurableObject } from "cloudflare:workers";

import { refuse } from "../cloud-http";
import { errorFields } from "../log";
import { purgeAccount } from "./account-purge";
import { blobKey } from "./cell-blobs";
import type { UploadRequest, UploadRoom } from "./cell-blobs";
import {
  logJobFailure,
  openCellLibrary,
  removeStrays,
  scheduleAlarm,
  settleCommit,
} from "./cell-library";
import type { CellResult } from "./cell-refusal";
import { openCellSchema } from "./cell-schema";
import {
  acceptSocket,
  holderFromHeader,
  pingVaultMoved,
  severHolder,
  SOCKET_HOLDER_HEADER,
  socketHolder,
} from "./cell-sockets";
import { cellAccountId } from "./library-cell";
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

  // the socket upgrade, its holder stamped by the Worker that verified it (`./socket-routes`)
  override fetch(request: Request): Response {
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

  override async alarm(): Promise<void> {
    const library = openCellLibrary(this.ctx, this.env);
    try {
      library.runDueJobs(logJobFailure);
      await removeStrays(this.env, this.#accountId, library);
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
    return await settleCommit(this.ctx, library, library.reserve(request));
  }

  // the file's row once its upload is in R2, at the size R2 holds; the transaction reads the
  // upload's record after this await, so nothing read before it is trusted but the count of stray
  // removals, which tells it whether one ran meanwhile
  async settleBlob(sha: string): Promise<CellResult<UploadSettlement>> {
    const library = openCellLibrary(this.ctx, this.env);
    const removalsSeen = library.blobRemovals();
    const object = await this.env.BLOBS.head(blobKey(this.#accountId, sha));
    const stored =
      object === null
        ? null
        : {
            bytes: object.size,
            mime: object.httpMetadata?.contentType ?? "application/octet-stream",
          };
    return await settleCommit(this.ctx, library, library.settle(sha, stored, removalsSeen));
  }
}
