import { db } from "@repo/db/drizzle-client";

import { scheduleBackground } from "../background";
import { serveCron } from "../cron";
import { env } from "../env";
import { errorFields } from "../log";
import { JOB_RUNS } from "./job-kinds";
import type { JobRuns } from "./job-kinds";
import { finishJob, leaseJobs, retryJob } from "./job-queue";
import type { Lease } from "./job-queue";

interface Drain {
  readonly accountId: string | null;
  readonly budgetMs: number;
  readonly runs?: JobRuns;
}

interface Drained {
  ran: number;
  failed: number;
  dropped: number;
}

const logLease = (lease: Lease) => ({ attempts: lease.attempts, id: lease.id, kind: lease.kind });

const runLeased = async (runs: JobRuns, lease: Lease) => {
  try {
    const outcome = await runs[lease.kind](lease);

    switch (outcome) {
      case "done": {
        await finishJob(db, lease);

        return "ran" as const;
      }

      case "unreadable": {
        console.error({ event: "job-unreadable", ...logLease(lease) });
        await finishJob(db, lease);

        return "dropped" as const;
      }

      case "retry": {
        await retryJob(db, lease, Date.now());

        return "failed" as const;
      }

      default: {
        throw new Error(`unexpected ${String(outcome satisfies never)}`);
      }
    }
  } catch (error) {
    console.error({ event: "job-failed", ...logLease(lease), ...errorFields(error) });
    await retryJob(db, lease, Date.now());

    return "failed" as const;
  }
};

export const drainJobs = async ({ accountId, budgetMs, runs = JOB_RUNS }: Drain) => {
  const until = Date.now() + budgetMs;
  const drained: Drained = { dropped: 0, failed: 0, ran: 0 };

  while (Date.now() < until) {
    const [lease] = await leaseJobs(db, { accountId, limit: 1, now: Date.now() });

    if (lease === undefined) {
      break;
    }

    drained[await runLeased(runs, lease)] += 1;
  }

  return drained;
};

const KICK_BUDGET_MS = 50_000;

export const kickJobs = (accountId: string) => {
  scheduleBackground(async () => {
    await drainJobs({ accountId, budgetMs: KICK_BUDGET_MS });
  }, "jobs");
};

const CRON_BUDGET_MS = 240_000;

export const serveJobsCron = async (request: Request) =>
  await serveCron(
    request,
    env.CRON_SECRET,
    async () => await drainJobs({ accountId: null, budgetMs: CRON_BUDGET_MS }),
  );
