// What the cell's alarm does around its engine's transactions, on the platform's bindings: the
// jobs that wait on one, a reading's send to the fill queue and a stray file's removal from R2;
// and a file's row settled once R2 holds its bytes.

import { UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";

import { errorFields } from "../log";
import { blobKey } from "./cell-blobs";
import type { Settlement } from "./cell-blobs";
import type { ClaimedFill } from "./cell-fills";
import type { DueJob } from "./cell-jobs";
import type { CellResult } from "./cell-refusal";
import { cellAccountId } from "./library-cell";
import type { LibraryEngine } from "./library-engine";

// a queue takes at most 100 messages a send (developers.cloudflare.com/queues/platform/limits/)
const SEND_BATCH = 100;

// the readings waiting to be sent, in sends of a hundred, by the alarm alone: a reading due now
// sets the alarm now, a send that fails leaves its rows for the alarm a minute on, and the queue's
// consumer lands a reading met twice once
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

// a file's row once its upload is in R2, at the size R2 holds; the transaction reads the upload's
// record after this await, so nothing read before it is trusted but the count of stray removals,
// which tells it whether one ran meanwhile. One that did is most often another file's, so R2 is
// read once more before the device is asked to send again. Every writer settles here, a device's
// upload and a page's file the fill kept, so this is where bytes that took their room before the
// account's tombstone and reached R2 after its files went are taken out again: nothing under a
// deleted account's prefix stays (`./account-purge`)
export const settleStored = async (
  env: Env,
  accountId: string,
  library: LibraryEngine,
  sha: string,
): Promise<CellResult<Settlement>> => {
  const key = blobKey(accountId, sha);
  const look = async (): Promise<CellResult<Settlement>> => {
    const removalsSeen = library.blobRemovals();
    const object = await env.BLOBS.head(key);
    const stored =
      object === null
        ? null
        : {
            bytes: object.size,
            mime: object.httpMetadata?.contentType ?? UNKNOWN_FILE_TYPE,
          };
    return library.settle(sha, stored, removalsSeen);
  };
  let settled = await look();
  if (settled.ok && settled.value === "stale") {
    settled = await look();
  }
  if (!settled.ok && settled.refusal.kind === "gone") {
    await env.BLOBS.delete(key);
  }
  return settled;
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
