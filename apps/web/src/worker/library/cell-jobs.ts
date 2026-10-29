// The cell's one alarm runs what the `jobs` table holds: a change set to seal once its actor goes
// quiet, the daily prune of history, an upload whose room was held too long, a file no item named
// in its first day, a stray file to take out of R2, a page's reading to send to the fill queue, an
// import's next page, an export to write and one to let go. A job is a row, so it survives
// eviction and a missed alarm; the alarm is set to the earliest due one, and only while any is
// waiting (https://developers.cloudflare.com/durable-objects/api/alarms/).

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

const JOB_KINDS = [
  "seal",
  "prune",
  "upload",
  "unnamed",
  "stray",
  "fill",
  "import",
  "export",
  "expire",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface DueJob<K extends JobKind = JobKind> {
  readonly id: string;
  readonly kind: K;
  readonly payload: string;
  readonly attempts: number;
}

// a job waiting for its turn; a run that fails tries again later, as `attempts` counts
const JOB_STATE = "waiting";

// a job asked for at `nextAt`; one already waiting is asked for again, its count of failed runs
// started over
export const scheduleJob = (
  sql: SqlStatements,
  job: { readonly id: string; readonly kind: JobKind; readonly payload: string },
  nextAt: number,
): void => {
  sql.run(
    `INSERT INTO jobs (id, kind, state, payload, attempts, next_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, next_at = excluded.next_at,
       attempts = 0`,
    [job.id, job.kind, JOB_STATE, job.payload, nextAt],
  );
};

// a job made only if it is not already waiting, its time left alone
export const ensureJob = (
  sql: SqlStatements,
  job: { readonly id: string; readonly kind: JobKind; readonly payload: string },
  nextAt: number,
): void => {
  sql.run(
    `INSERT INTO jobs (id, kind, state, payload, attempts, next_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (id) DO NOTHING`,
    [job.id, job.kind, JOB_STATE, job.payload, nextAt],
  );
};

export const dropJob = (sql: SqlStatements, id: string): void => {
  sql.run("DELETE FROM jobs WHERE id = ?", [id]);
};

// a job's next run moved, its attempts counted
export const deferJob = (sql: SqlStatements, id: string, nextAt: number): void => {
  sql.run("UPDATE jobs SET attempts = attempts + 1, next_at = ? WHERE id = ?", [nextAt, id]);
};

// a failed run waits longer each time, at most an hour
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

// a failed run counted, and the next put off. A job whose run the platform may end (past its CPU,
// its memory), which no catch would see, counts its run so before it starts, and the run that gets
// somewhere asks for its next itself (`scheduleJob`), starting the count over
export const retryJob = (sql: SqlStatements, job: DueJob, now: number): void => {
  const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** job.attempts);
  sql.run("UPDATE jobs SET attempts = attempts + 1, next_at = ? WHERE id = ?", [
    now + wait,
    job.id,
  ]);
};

// what one alarm run takes on of each lot, the longest waiting first
const DUE_PER_RUN = 50;

// the due jobs of `kinds`
export const dueJobs = <K extends JobKind>(
  sql: SqlStatements,
  now: number,
  kinds: readonly [K, ...K[]],
): DueJob<K>[] => {
  const rowSchema = z.object({
    attempts: z.number().int().nonnegative(),
    id: z.string(),
    kind: z.enum(kinds),
    payload: z.string(),
  });
  return sql
    .all(
      `SELECT id, kind, payload, attempts FROM jobs
       WHERE next_at <= ? AND kind IN (${kinds.map(() => "?").join(", ")})
       ORDER BY next_at, id LIMIT ?`,
      [now, ...kinds, DUE_PER_RUN],
    )
    .map((row) => rowSchema.parse(row));
};

const nextRowSchema = z.object({ next: z.number().nullable() });

export const nextJobAt = (sql: SqlStatements): number | null => {
  const [row] = sql.all("SELECT min(next_at) AS next FROM jobs", []);
  return nextRowSchema.parse(row).next;
};
