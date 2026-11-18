// The drain: due jobs leased one at a time and run in turn (`./job-kinds`) until its budget is
// spent, by Vercel Cron every minute across accounts (apps/web/vercel.json), and after a response
// by the door whose write asked one (`kickJobs`). One lease at a time leaves no leased job waiting
// on a drain that ran out of budget. A run that throws or asks to be tried again waits its backoff;
// a payload its kind no longer reads is dropped.

import { db } from "@repo/db/drizzle-client";
import { jobKind } from "@repo/db/library-schema";

import { scheduleBackground } from "../background";
import { serveCron } from "../cron";
import { env } from "../env";
import { errorFields } from "../log";
import { JOB_RUNS } from "./job-kinds";
import type { JobRuns } from "./job-kinds";
import { finishJob, leaseJobs, retryJob } from "./job-queue";
import type { Lease } from "./job-queue";

interface Drain {
  // one account's jobs, or every account's, the longest waiting first, when null
  readonly accountId: string | null;
  // no job is leased past it, though the last one leased may run on beyond it
  readonly budgetMs: number;
  readonly runs?: JobRuns;
}

// what a drain did: jobs run to their end, jobs left for their backoff, and payloads dropped
interface Drained {
  ran: number;
  failed: number;
  dropped: number;
}

const logLease = (lease: Lease) => ({ attempts: lease.attempts, id: lease.id, kind: lease.kind });

const runLeased = async (runs: JobRuns, lease: Lease): Promise<keyof Drained> => {
  const run = runs[lease.kind];
  if (run === null) {
    throw new Error(`a ${lease.kind} job was leased, a kind no run takes`);
  }
  try {
    const outcome = await run(lease);
    switch (outcome) {
      case "done": {
        await finishJob(db, lease);
        return "ran";
      }
      case "unreadable": {
        console.error({ event: "job-unreadable", ...logLease(lease) });
        await finishJob(db, lease);
        return "dropped";
      }
      case "retry": {
        await retryJob(db, lease, Date.now());
        return "failed";
      }
      // no default
    }
  } catch (error) {
    console.error({ event: "job-failed", ...logLease(lease), ...errorFields(error) });
    await retryJob(db, lease, Date.now());
    return "failed";
  }
};

export const drainJobs = async ({
  accountId,
  budgetMs,
  runs = JOB_RUNS,
}: Drain): Promise<Drained> => {
  const until = Date.now() + budgetMs;
  const kinds = jobKind.enumValues.filter((kind) => runs[kind] !== null);
  const drained: Drained = { dropped: 0, failed: 0, ran: 0 };
  while (Date.now() < until) {
    const [lease] = await leaseJobs(db, { accountId, kinds, limit: 1, now: Date.now() });
    if (lease === undefined) {
      break;
    }
    drained[await runLeased(runs, lease)] += 1;
  }
  return drained;
};

// a kick's drain, the account's alone, inside the route's 300 s beside the request and the last
// job it leases
const KICK_BUDGET_MS = 50_000;

export const kickJobs = (accountId: string): void => {
  scheduleBackground(async () => {
    await drainJobs({ accountId, budgetMs: KICK_BUDGET_MS });
  }, "jobs");
};

// the cron's drain, inside its route's 300 s beside the last job it leases
const CRON_BUDGET_MS = 240_000;

export const serveJobsCron = async (request: Request): Promise<Response> =>
  await serveCron(
    request,
    env.CRON_SECRET,
    async () => await drainJobs({ accountId: null, budgetMs: CRON_BUDGET_MS }),
  );
