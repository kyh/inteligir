import type { DbExecutor } from "@repo/db/drizzle-client";
import { job } from "@repo/db/library-schema";
import type { jobKind } from "@repo/db/library-schema";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { z } from "zod";

import { chunksOf } from "./set-sql";

export type JobKind = (typeof jobKind.enumValues)[number];

export interface JobAsk {
  readonly accountId: string;
  readonly id: string;
  readonly kind: JobKind;
  readonly payload: unknown;
}

export interface DelayedAsk extends JobAsk {
  readonly afterMs?: number;
}

export interface Lease extends JobAsk {
  readonly attempts: number;
  readonly runAt: number;
}

const LEASE_MS = 300_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

export type JobOutcome = "done" | "retry";

type JobAttempt = Pick<Lease, "accountId" | "attempts">;

type Tries<P> =
  | { readonly kind: "until-done" }
  | {
      readonly kind: "at-most";
      readonly max: number;
      readonly exhausted: (payload: P, job: JobAttempt) => Promise<void>;
    };

export interface JobRun<P> {
  readonly payload: z.ZodType<P>;
  readonly tries: Tries<P>;
  readonly run: (payload: P, job: JobAttempt & { readonly final: boolean }) => Promise<JobOutcome>;
}

export const askJobs = async (tx: DbExecutor, asks: readonly DelayedAsk[], now: number) => {
  const rows = asks.map(({ afterMs = 0, ...ask }) => ({
    ...ask,
    createdAt: now,
    runAt: now + afterMs,
  }));

  for (const chunk of chunksOf(rows, 1000)) {
    await tx
      .insert(job)
      .values(chunk)
      .onConflictDoUpdate({
        set: { attempts: 0, payload: sql`excluded.payload`, runAt: sql`excluded.run_at` },
        target: [job.accountId, job.id],
      });
  }
};

interface LeaseAsk {
  readonly now: number;
  readonly limit: number;
  readonly accountId: string | null;
}

export const leaseJobs = async (tx: DbExecutor, { accountId, limit, now }: LeaseAsk) => {
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

export const finishJob = async (tx: DbExecutor, lease: Lease) => {
  await tx.delete(job).where(stillLeased(lease));
};

export const retryJob = async (tx: DbExecutor, lease: Lease, now: number) => {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (lease.attempts - 1));
  await tx
    .update(job)
    .set({ runAt: now + backoff })
    .where(stillLeased(lease));
};
