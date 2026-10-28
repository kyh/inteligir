// The cell's one alarm runs what the `jobs` table holds: a change set to seal once its actor goes
// quiet, the daily prune of history, an upload whose room was held too long. A job is a row, so it
// survives eviction and a missed alarm; the alarm is set to the earliest due one, and only while
// any is waiting (https://developers.cloudflare.com/durable-objects/api/alarms/).

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

const JOB_KINDS = ["seal", "prune", "upload"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface DueJob {
  readonly id: string;
  readonly kind: JobKind;
  readonly payload: string;
  readonly attempts: number;
}

// a job waiting for its turn; a run that fails tries again later, as `attempts` counts
const JOB_STATE = "waiting";

export const scheduleJob = (
  sql: SqlStatements,
  job: { readonly id: string; readonly kind: JobKind; readonly payload: string },
  nextAt: number,
): void => {
  sql.run(
    `INSERT INTO jobs (id, kind, state, payload, attempts, next_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, next_at = excluded.next_at`,
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

// a failed run waits longer each time, at most an hour
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

export const retryJob = (sql: SqlStatements, job: DueJob, now: number): void => {
  const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** job.attempts);
  sql.run("UPDATE jobs SET attempts = attempts + 1, next_at = ? WHERE id = ?", [
    now + wait,
    job.id,
  ]);
};

const jobRowSchema = z.object({
  attempts: z.number().int().nonnegative(),
  id: z.string(),
  kind: z.enum(JOB_KINDS),
  payload: z.string(),
});

// what one alarm run takes on, the longest waiting first
const DUE_PER_RUN = 50;

export const dueJobs = (sql: SqlStatements, now: number): DueJob[] =>
  sql
    .all(
      "SELECT id, kind, payload, attempts FROM jobs WHERE next_at <= ? ORDER BY next_at, id LIMIT ?",
      [now, DUE_PER_RUN],
    )
    .map((row) => jobRowSchema.parse(row));

const nextRowSchema = z.object({ next: z.number().nullable() });

export const nextJobAt = (sql: SqlStatements): number | null => {
  const [row] = sql.all("SELECT min(next_at) AS next FROM jobs", []);
  return nextRowSchema.parse(row).next;
};
