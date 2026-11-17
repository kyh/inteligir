// What the cell's alarm runs: every kind of job (`./cell-jobs`), a kind at a time in the order the
// schema names them, each kind's due rows leased as one lot and handed to its run in the table
// below. A job the storage alone settles runs and ends in one transaction; one that waits on R2,
// the fill queue or another object works between two, on the platform's bindings. A run that
// throws leaves its lease, so the row waits its turn again, longer each time.

import { JOB_KINDS } from "@repo/db/cell/schema";

import { deliverTurn, watchTurn } from "../agent/agent-turns";
import { errorFields } from "../log";
import {
  beginRemoval,
  blobKey,
  endRemoval,
  failRemoval,
  releaseUnnamed,
  releaseUpload,
} from "./cell-blobs";
import type { CellDb } from "./cell-db";
import { fillsToSend } from "./cell-fills";
import { finishJob, leaseJobs, scheduleJob } from "./cell-jobs";
import type { JobKind, JobPayload, Lease } from "./cell-jobs";
import { PRUNE_EVERY_MS, PRUNE_JOB } from "./change-sets";
import { pruneChangeSets } from "./change-set-prune";
import type { Cell } from "./open-cell";

// a kind's run: the lot the alarm leased of it
type Run<K extends JobKind> = (cell: Cell, lot: readonly Lease<K>[]) => Promise<void>;

// every kind's run, so a kind with none fails to compile
type Runs = { readonly [K in JobKind]: Run<K> };

const logFailure = (job: Pick<Lease, "attempts" | "kind">, cause: unknown): void => {
  console.error({
    attempts: job.attempts,
    event: "library-job-failed",
    job: job.kind,
    ...errorFields(cause),
  });
};

// a kind whose jobs run each alone: one that throws keeps its lease, and the rest still run
const each =
  <K extends JobKind>(run: (cell: Cell, job: Lease<K>) => Promise<void> | void): Run<K> =>
  async (cell, lot) => {
    for (const job of lot) {
      try {
        await run(cell, job);
      } catch (error) {
        logFailure(job, error);
      }
    }
  };

// a job the storage alone settles, run and ended in one transaction: the row goes unless its run
// asked for it again
const stored = <K extends JobKind>(
  run: (db: CellDb, now: number, payload: JobPayload<K>) => void,
): Run<K> =>
  each(({ library }, job) => {
    library.rows((db, now) => {
      run(db, now, job.payload);
      finishJob(db, job);
    });
  });

// The readings due, sent to the fill queue in one send, by the alarm alone: a queue takes at most
// 100 messages a send (developers.cloudflare.com/queues/platform/limits/), and a lot is 50. A send
// that fails keeps its leases, and the queue's consumer lands a reading met twice once
const sendFills: Run<"fill"> = async ({ accountId, env, library }, lot) => {
  const due = library.rows((db, now) => fillsToSend(db, now, lot));
  if (!due.ok || due.value.length === 0) {
    return;
  }
  const sends = due.value;
  try {
    await env.FILLS.sendBatch(
      sends.map(({ request }) => ({ body: { accountId, ...request }, contentType: "json" })),
    );
  } catch (error) {
    console.warn({ event: "fill-send-failed", fills: sends.length, ...errorFields(error) });
    return;
  }
  library.rows((db) => {
    for (const { job } of sends) {
      finishJob(db, job);
    }
  });
};

// the strays due, taken out of R2 in one delete (at most 1,000 keys a call, and a lot is 50)
// between the transaction that begins them and the one that ends them (`./cell-blobs`)
const removeStrays: Run<"stray"> = async ({ accountId, env, library }, lot) => {
  const begun = library.rows((db) => lot.filter((job) => beginRemoval(db, job.payload.sha)));
  if (!begun.ok || begun.value.length === 0) {
    return;
  }
  const removals = begun.value;
  try {
    await env.BLOBS.delete(removals.map((job) => blobKey(accountId, job.payload.sha)));
  } catch (error) {
    for (const job of removals) {
      logFailure(job, error);
    }
    library.rows((db) => {
      for (const job of removals) {
        failRemoval(db, job.payload.sha);
      }
    });
    return;
  }
  library.rows((db) => {
    for (const job of removals) {
      endRemoval(db, job.payload.sha);
    }
  });
};

// the prune drops a page a run, so it runs again this soon while more wait
const PRUNE_AGAIN_MS = 1000;

const RUNS: Runs = {
  "agent-deliver": each(async (cell, job) => {
    await deliverTurn(cell, job.payload.threadId);
  }),
  "agent-watch": each(async (cell, job) => {
    await watchTurn(cell, job.payload.threadId);
  }),
  fill: sendFills,
  // a purged item's note, emptied in its own object
  "note-purge": each(async ({ library, notes }, job) => {
    await notes(job.payload.itemId).purge();
    library.rows((db) => {
      finishJob(db, job);
    });
  }),
  prune: stored((db, now) => {
    const more = pruneChangeSets(db, now);
    scheduleJob(db, PRUNE_JOB, now + (more ? PRUNE_AGAIN_MS : PRUNE_EVERY_MS));
  }),
  stray: removeStrays,
  unnamed: stored((db, now, { sha }) => {
    releaseUnnamed(db, [sha], now);
  }),
  upload: stored((db, now, { sha }) => {
    releaseUpload(db, sha, now);
  }),
};

// one kind's due jobs, leased and run: the lot it took, none once the account is being deleted
export const runKind = async <K extends JobKind>(
  cell: Cell,
  kind: K,
): Promise<readonly Lease<K>[]> => {
  const leased = cell.library.rows((db, now) => leaseJobs(db, now, kind));
  const lot = leased.ok ? leased.value : [];
  if (lot.length > 0) {
    await RUNS[kind](cell, lot);
  }
  return lot;
};

// every job due: the storage's own kinds come first in the schema's order, so a file one of them
// lets go is a stray the same run takes out of R2
export const runJobs = async (cell: Cell): Promise<void> => {
  for (const kind of JOB_KINDS) {
    await runKind(cell, kind);
  }
};
