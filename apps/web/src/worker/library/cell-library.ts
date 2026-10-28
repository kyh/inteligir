// The cell's engine as the Durable Object runs it: over its own storage, the platform's clock and
// ids, and the account's cap; what follows a committed write, the socket ping (held by the output
// gate until the write is durable, never sent unconfirmed) and the alarm set to the earliest job;
// and the one job that waits on R2, a stray file's removal. The router the cell serves and a test
// running inside the cell open it the same way.

import { errorFields } from "../log";
import { blobKey } from "./cell-blobs";
import type { DueJob } from "./cell-jobs";
import type { CellResult } from "./cell-refusal";
import { pingLibraryMoved } from "./cell-sockets";
import { cellStorageOf } from "./cell-storage";
import { openLibraryEngine } from "./library-engine";
import type { LibraryEngine } from "./library-engine";

const STORAGE_CAP = /^[1-9]\d*$/u;

// what one account's library may hold, its history included: 1 GiB
const libraryStorageCap = (env: Env): number => {
  const cap = env.LIBRARY_STORAGE_CAP_BYTES;
  if (!STORAGE_CAP.test(cap)) {
    throw new Error(`LIBRARY_STORAGE_CAP_BYTES must be a whole number of bytes, not "${cap}"`);
  }
  return Number(cap);
};

export const openCellLibrary = (ctx: DurableObjectState, env: Env): LibraryEngine =>
  openLibraryEngine({
    bytesCap: libraryStorageCap(env),
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
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

export const settleCommit = async <T>(
  ctx: DurableObjectState,
  library: LibraryEngine,
  result: CellResult<T>,
): Promise<CellResult<T>> => {
  if (result.ok && result.head !== null) {
    pingLibraryMoved(ctx, result.head);
  }
  await scheduleAlarm(ctx, library);
  return result;
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
