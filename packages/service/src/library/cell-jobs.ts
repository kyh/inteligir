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
import { jsonTextSchema } from "./sql-value";

const threadSchema = z.object({ threadId: z.string().min(1) });
const fileSchema = z.object({ sha: z.string() });

// each kind's payload, which its writer and its run both read
const PAYLOAD_SCHEMAS = {
  "agent-deliver": threadSchema,
  "agent-watch": threadSchema,
  // a reading the built-in agent's turn holds names its change set, and waits until the set seals
  fill: z.strictObject({
    coverHint: z.string().nullable(),
    heldBy: z.string().nullable(),
    itemId: z.string(),
    url: z.string(),
  }),
  import: z.object({ jobId: z.string() }),
  "note-purge": z.object({ itemId: z.string() }),
  prune: z.object({}),
  seal: z.object({ changeSetId: z.string() }),
  stray: fileSchema,
  unnamed: fileSchema,
  upload: fileSchema,
};

export type JobKind = keyof typeof PAYLOAD_SCHEMAS;
export type JobPayload<K extends JobKind> = z.output<(typeof PAYLOAD_SCHEMAS)[K]>;

// the same table typed by kind, so a kind's schema reads as its own payload's
type PayloadTable = { readonly [K in JobKind]: z.ZodType<JobPayload<K>> };
const PAYLOADS: PayloadTable = PAYLOAD_SCHEMAS;

// a union over its kinds, so a run that switches on `kind` reads that kind's payload
export type DueJob<K extends JobKind = JobKind> = {
  readonly [P in K]: {
    readonly id: string;
    readonly kind: P;
    readonly payload: JobPayload<P>;
    readonly attempts: number;
  };
}[K];

export interface JobRequest<K extends JobKind> {
  readonly id: string;
  readonly kind: K;
  readonly payload: JobPayload<K>;
}

// the payload as its row stores it
export const payloadText = <K extends JobKind>(kind: K, payload: JobPayload<K>): string =>
  JSON.stringify(PAYLOADS[kind].parse(payload));

const readPayload = <K extends JobKind>(kind: K, text: string): JobPayload<K> | null => {
  const json = jsonTextSchema.safeParse(text);
  const payload = PAYLOADS[kind].safeParse(json.success ? json.data : null);
  return payload.success ? payload.data : null;
};

const rowOf = <K extends JobKind>(job: JobRequest<K>, nextAt: number) => ({
  attempts: 0,
  id: job.id,
  kind: job.kind,
  nextAt,
  payload: payloadText(job.kind, job.payload),
});

// a job asked for at `nextAt`; one already waiting is asked for again, its count of failed runs
// started over
export const scheduleJob = <K extends JobKind>(
  db: CellDb,
  job: JobRequest<K>,
  nextAt: number,
): void => {
  db.insert(jobs)
    .values(rowOf(job, nextAt))
    .onConflictDoUpdate({
      set: { attempts: 0, nextAt: excluded(jobs.nextAt), payload: excluded(jobs.payload) },
      target: jobs.id,
    })
    .run();
};

// a job made only if it is not already waiting, its time left alone
export const ensureJob = <K extends JobKind>(
  db: CellDb,
  job: JobRequest<K>,
  nextAt: number,
): void => {
  db.insert(jobs).values(rowOf(job, nextAt)).onConflictDoNothing({ target: jobs.id }).run();
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

// the due jobs of `kinds`, each payload read as its kind's. A row whose payload its kind no longer
// reads is dropped, since no run could take it and its due time would hold the alarm on it
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
    .flatMap((row) => {
      const kind = kindSchema.parse(row.kind);
      const payload = readPayload(kind, row.payload);
      if (payload === null) {
        console.error({ event: "job-unreadable", id: row.id, kind });
        dropJob(db, row.id);
        return [];
      }
      const job: DueJob<K> = { attempts: row.attempts, id: row.id, kind, payload };
      return [job];
    });
};

// the payload of every job of `kind`, due or not, but one its kind no longer reads
export const waitingPayloads = <K extends JobKind>(db: CellDb, kind: K): JobPayload<K>[] =>
  db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(eq(jobs.kind, kind))
    .all()
    .flatMap((row) => {
      const payload = readPayload(kind, row.payload);
      return payload === null ? [] : [payload];
    });

export const nextJobAt = (db: CellDb): number | null =>
  db
    .select({ next: min(jobs.nextAt) })
    .from(jobs)
    .get()?.next ?? null;
