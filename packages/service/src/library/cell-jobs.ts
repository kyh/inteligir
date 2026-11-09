// The cell's one alarm runs what the `jobs` table holds: a change set to seal once its actor goes
// quiet, the daily prune of change sets, an upload whose room was held too long, a file nothing may
// name any more, a stray file to take out of R2, a page's reading to send to the fill queue, an
// import's next page, and the built-in agent's turns: one to hand to its conversation's object,
// and one whose object has gone quiet to ask after. A job is a row, so it survives eviction and a
// missed alarm; the alarm is set to the earliest due one, and only while any is waiting
// (https://developers.cloudflare.com/durable-objects/api/alarms/).

import { and, asc, eq, inArray, lte, min, sql } from "drizzle-orm";
import { z } from "zod";

import { jobs } from "@repo/db/cell/schema";
import { excluded } from "./cell-db";
import type { CellDb } from "./cell-db";

const JOB_KINDS = [
  "seal",
  "prune",
  "upload",
  "unnamed",
  "stray",
  "fill",
  "import",
  "agent-deliver",
  "agent-watch",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface DueJob<K extends JobKind = JobKind> {
  readonly id: string;
  readonly kind: K;
  readonly payload: string;
  readonly attempts: number;
}

interface JobRequest {
  readonly id: string;
  readonly kind: JobKind;
  readonly payload: string;
}

// a job asked for at `nextAt`; one already waiting is asked for again, its count of failed runs
// started over
export const scheduleJob = (db: CellDb, job: JobRequest, nextAt: number): void => {
  db.insert(jobs)
    .values({ attempts: 0, id: job.id, kind: job.kind, nextAt, payload: job.payload })
    .onConflictDoUpdate({
      set: { attempts: 0, nextAt: excluded(jobs.nextAt), payload: excluded(jobs.payload) },
      target: jobs.id,
    })
    .run();
};

// a job made only if it is not already waiting, its time left alone
export const ensureJob = (db: CellDb, job: JobRequest, nextAt: number): void => {
  db.insert(jobs)
    .values({ attempts: 0, id: job.id, kind: job.kind, nextAt, payload: job.payload })
    .onConflictDoNothing({ target: jobs.id })
    .run();
};

export const dropJob = (db: CellDb, id: string): void => {
  db.delete(jobs).where(eq(jobs.id, id)).run();
};

// a job's next run moved, its attempts counted
export const deferJob = (db: CellDb, id: string, nextAt: number): void => {
  db.update(jobs)
    .set({ attempts: sql`${jobs.attempts} + 1`, nextAt })
    .where(eq(jobs.id, id))
    .run();
};

// a failed run waits longer each time, at most an hour
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

// a failed run counted, and the next put off. A job whose run the platform may end (past its CPU,
// its memory), which no catch would see, counts its run so before it starts, and the run that gets
// somewhere asks for its next itself (`scheduleJob`), starting the count over
export const retryJob = (db: CellDb, job: DueJob, now: number): void => {
  deferJob(db, job.id, now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** job.attempts));
};

// what one alarm run takes on of each lot, the longest waiting first
const DUE_PER_RUN = 50;

// the due jobs of `kinds`
export const dueJobs = <K extends JobKind>(
  db: CellDb,
  now: number,
  kinds: readonly [K, ...K[]],
): DueJob<K>[] => {
  const kindSchema = z.enum(kinds);
  return db
    .select({ attempts: jobs.attempts, id: jobs.id, kind: jobs.kind, payload: jobs.payload })
    .from(jobs)
    .where(and(lte(jobs.nextAt, now), inArray(jobs.kind, kinds)))
    .orderBy(asc(jobs.nextAt), asc(jobs.id))
    .limit(DUE_PER_RUN)
    .all()
    .map((row) => ({ ...row, kind: kindSchema.parse(row.kind) }));
};

export const nextJobAt = (db: CellDb): number | null =>
  db
    .select({ next: min(jobs.nextAt) })
    .from(jobs)
    .get()?.next ?? null;
