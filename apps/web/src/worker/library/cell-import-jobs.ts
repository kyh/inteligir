// An import's own rows: its job, which the person sees as it runs (what it found, added, already
// held, left out, could not read), and its plan, a row per thing it lands, so each of the alarm's
// runs reads only the page it lands and a run that stops part way resumes at its cursor. A row
// lands in the same transaction as the item it made, so a run cut off by an eviction neither
// loses nor repeats one.

import type { importJobSchema } from "@repo/contract/cloud/library/library-wire";
import { IMPORT_PHASES, IMPORT_SOURCES, IMPORT_STATES } from "@repo/notes/library/library-schema";
import { chunkStatement } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { dropJob, scheduleJob } from "./cell-jobs";

export type ImportSource = (typeof IMPORT_SOURCES)[number];
type ImportState = (typeof IMPORT_STATES)[number];
type ImportPhase = (typeof IMPORT_PHASES)[number];

const COUNTS = ["added", "alreadySaved", "skipped", "unreadable", "highlights"] as const;
type Count = (typeof COUNTS)[number];
type ImportCounts = Readonly<Partial<Record<Count, number>>>;

const COUNT_COLUMNS: Readonly<Record<Count, string>> = {
  added: "added",
  alreadySaved: "already_saved",
  highlights: "highlights",
  skipped: "skipped",
  unreadable: "unreadable",
};

export interface ImportJob {
  readonly id: string;
  readonly source: ImportSource;
  readonly sha: string;
  readonly state: ImportState;
  readonly phase: ImportPhase;
  readonly cursor: number;
  readonly total: number;
  readonly added: number;
  readonly alreadySaved: number;
  readonly skipped: number;
  readonly unreadable: number;
  readonly highlights: number;
  readonly changeSetId: string | null;
  readonly message: string | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

const count = z.number().int().nonnegative();

const rowSchema = z.object({
  added: count,
  already_saved: count,
  change_set_id: z.string().nullable(),
  cursor: count,
  finished_at: z.number().nullable(),
  highlights: count,
  id: z.string(),
  message: z.string().nullable(),
  phase: z.enum(IMPORT_PHASES),
  sha: z.string(),
  skipped: count,
  source: z.enum(IMPORT_SOURCES),
  started_at: z.number(),
  state: z.enum(IMPORT_STATES),
  total: count,
  unreadable: count,
});

const COLUMNS = `id, source, sha, state, phase, cursor, total, added, already_saved, skipped,
  unreadable, highlights, change_set_id, message, started_at, finished_at`;

const jobOf = (raw: SqlRow): ImportJob => {
  const row = rowSchema.parse(raw);
  return {
    added: row.added,
    alreadySaved: row.already_saved,
    changeSetId: row.change_set_id,
    cursor: row.cursor,
    finishedAt: row.finished_at,
    highlights: row.highlights,
    id: row.id,
    message: row.message,
    phase: row.phase,
    sha: row.sha,
    skipped: row.skipped,
    source: row.source,
    startedAt: row.started_at,
    state: row.state,
    total: row.total,
    unreadable: row.unreadable,
  };
};

// the job as the person sees it, its plan's place left out
export const importJobView = (job: ImportJob): z.input<typeof importJobSchema> => ({
  added: job.added,
  alreadySaved: job.alreadySaved,
  changeSetId: job.changeSetId,
  finishedAt: job.finishedAt,
  highlights: job.highlights,
  id: job.id,
  message: job.message,
  skipped: job.skipped,
  source: job.source,
  startedAt: job.startedAt,
  state: job.state,
  total: job.total,
  unreadable: job.unreadable,
});

export const readImportJob = (sql: SqlStatements, id: string): ImportJob | null => {
  const [raw] = sql.all(`SELECT ${COLUMNS} FROM import_jobs WHERE id = ?`, [id]);
  return raw === undefined ? null : jobOf(raw);
};

export const latestImportJob = (sql: SqlStatements): ImportJob | null => {
  const [raw] = sql.all(
    `SELECT ${COLUMNS} FROM import_jobs ORDER BY started_at DESC, id DESC LIMIT 1`,
    [],
  );
  return raw === undefined ? null : jobOf(raw);
};

const alarmJobId = (id: string): string => `import:${id}`;

const alarmJobSchema = z.object({ jobId: z.string() });

export const importJobIdOf = (payload: string): string =>
  alarmJobSchema.parse(JSON.parse(payload)).jobId;

// the import's next run, at once: a run does one page and asks for the next
export const runImportNext = (sql: SqlStatements, id: string, now: number): void => {
  scheduleJob(
    sql,
    { id: alarmJobId(id), kind: "import", payload: JSON.stringify({ jobId: id }) },
    now,
  );
};

export const insertImportJob = (
  sql: SqlStatements,
  job: { readonly id: string; readonly source: ImportSource; readonly sha: string },
  now: number,
): ImportJob => {
  sql.run(
    `INSERT INTO import_jobs (id, source, sha, state, phase, cursor, total, added, already_saved,
       skipped, unreadable, highlights, change_set_id, message, started_at, finished_at)
     VALUES (?, ?, ?, 'running', 'reading', 0, 0, 0, 0, 0, 0, 0, NULL, NULL, ?, NULL)`,
    [job.id, job.source, job.sha, now],
  );
  runImportNext(sql, job.id, now);
  const inserted = readImportJob(sql, job.id);
  if (inserted === null) {
    throw new Error("an import job just written is not there");
  }
  return inserted;
};

export interface ImportStep {
  readonly cursor: number;
  readonly phase?: ImportPhase | undefined;
  readonly total?: number | undefined;
  // each added to what the job counted so far
  readonly counts?: ImportCounts | undefined;
  readonly changeSetId?: string | undefined;
}

// the job moved on by one step: its cursor, its phase, what it counted
export const advanceImport = (sql: SqlStatements, id: string, step: ImportStep): void => {
  const sets = ["cursor = ?"];
  const params: (string | number)[] = [step.cursor];
  if (step.phase !== undefined) {
    sets.push("phase = ?");
    params.push(step.phase);
  }
  if (step.total !== undefined) {
    sets.push("total = ?");
    params.push(step.total);
  }
  if (step.changeSetId !== undefined) {
    sets.push("change_set_id = coalesce(change_set_id, ?)");
    params.push(step.changeSetId);
  }
  for (const name of COUNTS) {
    const delta = step.counts?.[name] ?? 0;
    if (delta !== 0) {
      sets.push(`${COUNT_COLUMNS[name]} = ${COUNT_COLUMNS[name]} + ?`);
      params.push(delta);
    }
  }
  sql.run(`UPDATE import_jobs SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
};

// a running job stopped where it stands; its rows go when the alarm next finishes it
export const stopImport = (
  sql: SqlStatements,
  id: string,
  ended: { readonly state: Exclude<ImportState, "running">; readonly message: string | null },
  now: number,
): void => {
  sql.run(
    `UPDATE import_jobs SET state = ?, message = ?, finished_at = ? WHERE id = ? AND state = 'running'`,
    [ended.state, ended.message, now, id],
  );
};

// what the job kept to run is let go once it ended
export const dropImportRuns = (sql: SqlStatements, id: string): void => {
  sql.run("DELETE FROM import_rows WHERE job_id = ?", [id]);
  dropJob(sql, alarmJobId(id));
};

// ---- the plan ----

export const putImportRows = (
  sql: SqlStatements,
  jobId: string,
  kind: string,
  rows: readonly { readonly idx: number; readonly value: unknown }[],
): void => {
  for (const statement of chunkStatement({
    each: "(?, ?, ?, ?)",
    head: "INSERT OR REPLACE INTO import_rows (job_id, kind, idx, json) VALUES ",
    rows: rows.map((row) => [jobId, kind, row.idx, JSON.stringify(row.value)]),
    separator: ", ",
    tail: "",
  })) {
    sql.run(statement.sql, statement.params);
  }
};

const planRowSchema = z.object({ idx: count, json: z.string() });

// a kind's rows from `from`, at most `limit`, in order
export const importRows = <T>(
  sql: SqlStatements,
  jobId: string,
  kind: string,
  page: { readonly from: number; readonly limit: number },
  schema: z.ZodType<T>,
): { readonly idx: number; readonly value: T }[] =>
  sql
    .all(
      "SELECT idx, json FROM import_rows WHERE job_id = ? AND kind = ? AND idx >= ? ORDER BY idx LIMIT ?",
      [jobId, kind, page.from, page.limit],
    )
    .map((raw) => {
      const row = planRowSchema.parse(raw);
      return { idx: row.idx, value: schema.parse(JSON.parse(row.json)) };
    });

export const dropImportRows = (sql: SqlStatements, jobId: string, kind: string): void => {
  sql.run("DELETE FROM import_rows WHERE job_id = ? AND kind = ?", [jobId, kind]);
};
