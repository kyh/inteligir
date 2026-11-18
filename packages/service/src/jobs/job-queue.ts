// The job table (`@repo/db/library-schema`'s `job`): work a write asked for, run once it commits by
// whichever drain leases it first (`./drain-jobs`). A row is one subject's (`sweep:<sweep>:<lot>`,
// `release:<pathname>`), so a second ask takes the place of one still waiting. A lease counts the
// run and holds the row for LEASE_MS before anything runs, under `for update skip locked`, so two
// drains never take one row, and a drain the platform cuts mid-job, where no catch runs, leaves a
// row that comes due again once its lease lapses. The run that gets somewhere ends the row
// (`finishJob`) or puts it off by its backoff (`retryJob`), each only while the row still holds that
// lease, so an ask made while it ran survives it.

import type { DbExecutor } from "@repo/db/drizzle-client";
import { job } from "@repo/db/library-schema";
import type { jobKind } from "@repo/db/library-schema";
import { and, asc, eq, lte, sql } from "drizzle-orm";

import { chunksOf } from "../library/set-sql";

export type JobKind = (typeof jobKind.enumValues)[number];

// work asked of one account, its payload read through its kind's schema when it runs
export interface JobAsk {
  readonly accountId: string;
  readonly id: string;
  readonly kind: JobKind;
  readonly payload: unknown;
}

// A job a drain took. `attempts` counts this run and `runAt` is when its lease lapses; together
// they tell this lease from any later ask for the job, which starts its count over
export interface Lease extends JobAsk {
  readonly attempts: number;
  readonly runAt: number;
}

// as long as a route that drains may run, Vercel's default and the crons' `maxDuration`, so a
// second drain never takes a job one the platform has not yet cut is still running
const LEASE_MS = 300_000;
// a failed run waits this long, doubled with each run before, at most an hour
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

// jobs asked, each due at `now`; one already waiting is asked again, its runs counted from none
export const askJobs = async (
  tx: DbExecutor,
  asks: readonly JobAsk[],
  now: number,
): Promise<void> => {
  const rows = asks.map((ask) => ({ ...ask, createdAt: now, runAt: now }));
  for (const chunk of chunksOf(rows, 1000)) {
    await tx
      .insert(job)
      .values(chunk)
      .onConflictDoUpdate({
        set: { attempts: 0, payload: sql`excluded.payload`, runAt: now },
        target: [job.accountId, job.id],
      });
  }
};

interface LeaseAsk {
  readonly now: number;
  readonly limit: number;
  // one account's jobs, or every account's when null
  readonly accountId: string | null;
}

// The due jobs, the longest waiting first, each taken: its run counted and its row held for the
// lease. A row another drain holds is passed over, not waited on
export const leaseJobs = async (
  tx: DbExecutor,
  { accountId, limit, now }: LeaseAsk,
): Promise<Lease[]> => {
  const due = tx
    .select({ accountId: job.accountId, id: job.id })
    .from(job)
    .where(and(lte(job.runAt, now), accountId === null ? undefined : eq(job.accountId, accountId)))
    .orderBy(asc(job.runAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  return await tx
    .update(job)
    .set({ attempts: sql`${job.attempts} + 1`, runAt: now + LEASE_MS })
    .where(sql`(${job.accountId}, ${job.id}) in ${due}`)
    .returning({
      accountId: job.accountId,
      attempts: job.attempts,
      id: job.id,
      kind: job.kind,
      payload: job.payload,
      runAt: job.runAt,
    });
};

const stillLeased = (lease: Lease) =>
  and(
    eq(job.accountId, lease.accountId),
    eq(job.id, lease.id),
    eq(job.attempts, lease.attempts),
    eq(job.runAt, lease.runAt),
  );

// a leased job done: its row goes, unless it was asked for again since the lease
export const finishJob = async (tx: DbExecutor, lease: Lease): Promise<void> => {
  await tx.delete(job).where(stillLeased(lease));
};

// a leased job that failed: due again after its backoff, unless it was asked for again since the
// lease, which keeps its own time
export const retryJob = async (tx: DbExecutor, lease: Lease, now: number): Promise<void> => {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (lease.attempts - 1));
  await tx
    .update(job)
    .set({ runAt: now + backoff })
    .where(stillLeased(lease));
};
