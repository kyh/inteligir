// The cell's one alarm runs what the `jobs` table holds (`./cell-alarm`): the daily prune of change
// sets, an upload whose room was held too long, a file nothing may name any more, a page's reading
// to send to the fill queue, a stray file to take out of R2, a purged item's note to empty, and the
// built-in agent's turns: one to hand to its conversation's object, and one whose object has gone
// quiet to ask after. A job is a row, so it survives eviction and a missed alarm; the alarm is set
// to the earliest due one, and only while any is waiting
// (https://developers.cloudflare.com/durable-objects/api/alarms/).
//
// A row's life is its `nextAt` and `attempts`. Asked for (`scheduleJob`, `ensureJob`), it waits
// until `nextAt`. A run takes it by a lease (`leaseJobs`), which counts the run and puts the row
// off by its backoff before anything runs, so a run that throws, or one the platform ends while
// it waits on R2, the queue or another object, where no catch sees it, leaves a row that waits its
// turn again and never one still due. The run that gets somewhere ends the row in a transaction of
// its own: dropped (`finishJob`, or the rule that owns it), or asked for again.

import { and, asc, eq, lte, min } from "drizzle-orm";
import { z } from "zod";

import { jobs } from "@repo/db/cell/schema";
import type { JOB_KINDS } from "@repo/db/cell/schema";
import { excluded } from "./cell-db";
import type { CellDb } from "./cell-db";
import { jsonTextSchema } from "./sql-value";

export type JobKind = (typeof JOB_KINDS)[number];

const threadSchema = z.object({ threadId: z.string().min(1) });
const fileSchema = z.object({ sha: z.string() });

// each kind's payload, which its writer and its run both read
const PAYLOAD_SCHEMAS = {
  "agent-deliver": threadSchema,
  "agent-watch": threadSchema,
  // a reading the built-in agent's turn holds names the turn, and waits until it seals
  fill: z.strictObject({
    coverHint: z.string().nullable(),
    heldBy: z.strictObject({ threadId: z.string(), turn: z.number().int() }).nullable(),
    itemId: z.string(),
    url: z.string(),
  }),
  "note-purge": z.object({ itemId: z.string() }),
  prune: z.object({}),
  stray: fileSchema,
  unnamed: fileSchema,
  upload: fileSchema,
} satisfies Record<JobKind, z.ZodType>;

export type JobPayload<K extends JobKind> = z.output<(typeof PAYLOAD_SCHEMAS)[K]>;

// the same table typed by kind, so a kind's schema reads as its own payload's
type PayloadTable = { readonly [K in JobKind]: z.ZodType<JobPayload<K>> };
const PAYLOADS: PayloadTable = PAYLOAD_SCHEMAS;

export interface JobRequest<K extends JobKind> {
  readonly id: string;
  readonly kind: K;
  readonly payload: JobPayload<K>;
}

// A job a run has taken. `attempts` counts this run, and `nextAt` is when the row comes due again
// unless the run ends it; together they tell this lease from any later ask for the job
export interface Lease<K extends JobKind = JobKind> extends JobRequest<K> {
  readonly attempts: number;
  readonly nextAt: number;
}

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
  payload: JSON.stringify(PAYLOADS[job.kind].parse(job.payload)),
});

// a job asked for at `nextAt`; one already waiting is asked for again, its count of runs started
// over, which also takes it back from a run that holds it
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

// a run that never ends its job leaves it this long, doubled with each run before, at most an hour
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

// what one alarm run takes on of each kind, the longest waiting first
const LOT = 50;

// The due jobs of `kind`, each taken: its run counted and its next put off by its backoff, in the
// transaction that reads it. A row whose payload its kind no longer reads is dropped, since no run
// could take it
export const leaseJobs = <K extends JobKind>(db: CellDb, now: number, kind: K): Lease<K>[] =>
  db
    .select({ attempts: jobs.attempts, id: jobs.id, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), lte(jobs.nextAt, now)))
    .orderBy(asc(jobs.nextAt), asc(jobs.id))
    .limit(LOT)
    .all()
    .flatMap((row) => {
      const payload = readPayload(kind, row.payload);
      if (payload === null) {
        console.error({ event: "job-unreadable", id: row.id, kind });
        dropJob(db, row.id);
        return [];
      }
      const attempts = row.attempts + 1;
      const nextAt = now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** row.attempts);
      db.update(jobs).set({ attempts, nextAt }).where(eq(jobs.id, row.id)).run();
      const lease: Lease<K> = { attempts, id: row.id, kind, nextAt, payload };
      return [lease];
    });

// a leased job done: its row goes, unless the job was asked for again since the lease, which waits
// for a run of its own
export const finishJob = (db: CellDb, lease: Pick<Lease, "attempts" | "id" | "nextAt">): void => {
  db.delete(jobs)
    .where(
      and(eq(jobs.id, lease.id), eq(jobs.attempts, lease.attempts), eq(jobs.nextAt, lease.nextAt)),
    )
    .run();
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
