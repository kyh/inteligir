// The cell's engine as the Durable Object runs it: over its own storage, the platform's clock and
// ids, and the account's cap; what follows a committed write, the socket ping (held by the output
// gate until the write is durable, never sent unconfirmed), the readings it asked for sent to the
// fill queue and the alarm set to the earliest job; and the jobs that wait on a binding, a stray
// file's removal from R2 and a reading's send. The router the cell serves and a test running
// inside the cell open it the same way.

import { errorFields } from "../log";
import { blobKey } from "./cell-blobs";
import type { ClaimedFill } from "./cell-fills";
import { cellIds } from "./cell-ids";
import type { DueJob } from "./cell-jobs";
import type { CellResult } from "./cell-refusal";
import { pingLibraryMoved } from "./cell-sockets";
import { cellStorageOf } from "./cell-storage";
import { cellAccountId } from "./library-cell";
import { openLibraryEngine } from "./library-engine";
import type { LibraryEngine, UploadSettlement } from "./library-engine";

const STORAGE_CAP = /^[1-9]\d*$/u;

// what one account's library may hold, its history included: 1 GiB
const libraryStorageCap = (env: Env): number => {
  const cap = env.LIBRARY_STORAGE_CAP_BYTES;
  if (!STORAGE_CAP.test(cap)) {
    throw new Error(`LIBRARY_STORAGE_CAP_BYTES must be a whole number of bytes, not "${cap}"`);
  }
  return Number(cap);
};

const now = (): number => Date.now();

export const openCellLibrary = (ctx: DurableObjectState, env: Env): LibraryEngine =>
  openLibraryEngine({
    bytesCap: libraryStorageCap(env),
    ids: cellIds(now),
    now,
    storage: cellStorageOf(ctx.storage),
  });

// the one alarm at the earliest waiting job, and none while no job waits; an alarm already set
// earlier stays, and finds nothing due or the job it was set for
export const scheduleAlarm = async (
  ctx: DurableObjectState,
  library: LibraryEngine,
): Promise<void> => {
  const next = library.nextJobAt();
  const current = await ctx.storage.getAlarm();
  if (next === null) {
    if (current !== null) {
      await ctx.storage.deleteAlarm();
    }
    return;
  }
  if (current === null || next < current) {
    await ctx.storage.setAlarm(next);
  }
};

// a queue takes at most 100 messages a send (developers.cloudflare.com/queues/platform/limits/)
const SEND_BATCH = 100;

// the readings waiting to be sent, in sends of a hundred; a send that fails leaves its rows for the
// alarm, a minute on, and the queue's consumer lands a reading met twice once
export const sendFills = async (
  ctx: DurableObjectState,
  env: Env,
  library: LibraryEngine,
): Promise<void> => {
  const claimed = library.claimDueFills();
  const accountId = cellAccountId(ctx.id.name);
  for (let at = 0; at < claimed.length; at += SEND_BATCH) {
    const lot: ClaimedFill[] = claimed.slice(at, at + SEND_BATCH);
    try {
      await env.FILLS.sendBatch(
        lot.map((fill) => ({ body: { accountId, ...fill.request }, contentType: "json" })),
      );
    } catch (error) {
      console.warn({ event: "fill-send-failed", fills: lot.length, ...errorFields(error) });
      return;
    }
    library.fillsSent(lot);
  }
};

export const settleCommit = async <T>(
  ctx: DurableObjectState,
  env: Env,
  library: LibraryEngine,
  result: CellResult<T>,
): Promise<CellResult<T>> => {
  if (result.ok && result.head !== null) {
    pingLibraryMoved(ctx, result.head);
    await sendFills(ctx, env, library);
  }
  await scheduleAlarm(ctx, library);
  return result;
};

// a file's row once its upload is in R2, at the size R2 holds; the transaction reads the upload's
// record after this await, so nothing read before it is trusted but the count of stray removals,
// which tells it whether one ran meanwhile
export const settleStored = async (
  env: Env,
  accountId: string,
  library: LibraryEngine,
  sha: string,
): Promise<CellResult<UploadSettlement>> => {
  const removalsSeen = library.blobRemovals();
  const object = await env.BLOBS.head(blobKey(accountId, sha));
  const stored =
    object === null
      ? null
      : {
          bytes: object.size,
          mime: object.httpMetadata?.contentType ?? "application/octet-stream",
        };
  return library.settle(sha, stored, removalsSeen);
};

export const logJobFailure = (job: DueJob, cause: unknown): void => {
  console.error({
    attempts: job.attempts,
    event: "library-job-failed",
    job: job.kind,
    ...errorFields(cause),
  });
};

// the strays due, taken out of R2 in one delete (at most 1,000 keys a call, and a run takes 50)
// between the transaction that begins them and the one that ends them (`./cell-blobs`)
export const removeStrays = async (
  env: Env,
  accountId: string,
  library: LibraryEngine,
): Promise<void> => {
  const removals = library.beginStrayRemovals();
  if (removals.length === 0) {
    return;
  }
  try {
    await env.BLOBS.delete(removals.map((removal) => blobKey(accountId, removal.sha)));
  } catch (error) {
    for (const removal of removals) {
      logJobFailure(removal.job, error);
    }
    library.endStrayRemovals(removals, false);
    return;
  }
  library.endStrayRemovals(removals, true);
};
