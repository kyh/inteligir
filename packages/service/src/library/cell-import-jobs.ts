// An import's own rows: its job, which the person sees as it runs (what it found, added, already
// held, left out, could not read), and its plan, a row per thing it lands, so each of the alarm's
// runs reads only the page it lands and a run that stops part way resumes at its cursor. A row
// lands in the same transaction as the item it made, so a run cut off by an eviction neither
// loses nor repeats one.

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { z } from "zod";

import { importJobs, importRows as planRows, jobs } from "@repo/db/cell/schema";
import type {
  importJobSchema,
  IMPORT_SOURCES,
  IMPORT_PHASES,
  IMPORT_STATES,
} from "@repo/contract/library/library-wire";
import { utf8ByteLength } from "@repo/contract/library/canonical-json";

import { excluded, insertChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { dropJob, scheduleJob } from "./cell-jobs";

export type ImportSource = (typeof IMPORT_SOURCES)[number];
type ImportState = (typeof IMPORT_STATES)[number];
type ImportPhase = (typeof IMPORT_PHASES)[number];

const COUNTS = ["added", "alreadySaved", "skipped", "unreadable"] as const;
type Count = (typeof COUNTS)[number];
type ImportCounts = Readonly<Partial<Record<Count, number>>>;

export type ImportJob = Readonly<typeof importJobs.$inferSelect>;

// the job as the person sees it, its plan's place left out
export const importJobView = (job: ImportJob): z.input<typeof importJobSchema> => ({
  added: job.added,
  alreadySaved: job.alreadySaved,
  changeSetId: job.changeSetId,
  finishedAt: job.finishedAt,
  id: job.id,
  message: job.message,
  skipped: job.skipped,
  source: job.source,
  startedAt: job.startedAt,
  state: job.state,
  total: job.total,
  unreadable: job.unreadable,
});

export const readImportJob = (db: CellDb, id: string): ImportJob | null =>
  db.select().from(importJobs).where(eq(importJobs.id, id)).get() ?? null;

export const latestImportJob = (db: CellDb): ImportJob | null =>
  db
    .select()
    .from(importJobs)
    .orderBy(desc(importJobs.startedAt), desc(importJobs.id))
    .limit(1)
    .get() ?? null;

const alarmJobId = (id: string): string => `import:${id}`;

// the import's next run, at once: a run does one page and asks for the next
export const runImportNext = (db: CellDb, id: string, now: number): void => {
  scheduleJob(db, { id: alarmJobId(id), kind: "import", payload: { jobId: id } }, now);
};

export const insertImportJob = (
  db: CellDb,
  job: { readonly id: string; readonly source: ImportSource; readonly sha: string },
  now: number,
): ImportJob => {
  const [inserted] = db
    .insert(importJobs)
    .values({
      added: 0,
      alreadySaved: 0,
      cursor: 0,
      id: job.id,
      phase: "reading",
      sha: job.sha,
      skipped: 0,
      source: job.source,
      startedAt: now,
      state: "running",
      total: 0,
      unreadable: 0,
    })
    .returning()
    .all();
  if (inserted === undefined) {
    throw new Error("an import job just written is not there");
  }
  runImportNext(db, job.id, now);
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

// the job moved on by one step: its cursor, its phase, what it counted; a run that moves it on
// starts the count of runs that did not over
export const advanceImport = (db: CellDb, id: string, step: ImportStep): void => {
  db.update(jobs)
    .set({ attempts: 0 })
    .where(eq(jobs.id, alarmJobId(id)))
    .run();
  const counted: Partial<Record<Count, SQL>> = {};
  for (const name of COUNTS) {
    const delta = step.counts?.[name] ?? 0;
    if (delta !== 0) {
      counted[name] = sql`${importJobs[name]} + ${delta}`;
    }
  }
  db.update(importJobs)
    .set({
      ...counted,
      changeSetId:
        step.changeSetId === undefined
          ? undefined
          : sql`coalesce(${importJobs.changeSetId}, ${step.changeSetId})`,
      cursor: step.cursor,
      phase: step.phase,
      total: step.total,
    })
    .where(eq(importJobs.id, id))
    .run();
};

// a running job stopped where it stands; its rows go when the alarm next finishes it
export const stopImport = (
  db: CellDb,
  id: string,
  ended: { readonly state: Exclude<ImportState, "running">; readonly message: string | null },
  now: number,
): void => {
  db.update(importJobs)
    .set({ finishedAt: now, message: ended.message, state: ended.state })
    .where(and(eq(importJobs.id, id), eq(importJobs.state, "running")))
    .run();
};

// whether an import runs: its plan may name a file no item names yet, so none is let go meanwhile
export const importsRunning = (db: CellDb): boolean =>
  db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(eq(importJobs.state, "running"))
    .limit(1)
    .get() !== undefined;

// what the job kept to run is let go once it ended
export const dropImportRuns = (db: CellDb, id: string): void => {
  db.delete(planRows).where(eq(planRows.jobId, id)).run();
  dropJob(db, alarmJobId(id));
};

// ---- the plan ----

// a plan row's JSON, with room under a SQLite Durable Object's 2 MB row for the columns beside it
// (https://developers.cloudflare.com/durable-objects/platform/limits/): one past it would throw
// and stop the whole import, where an entry that long is one left out
const IMPORT_ROW_MAX_BYTES = 1_900_000;

interface ImportRow {
  readonly idx: number;
  readonly value: unknown;
}

export const fitsImportRow = (row: ImportRow): boolean =>
  utf8ByteLength(JSON.stringify(row.value)) <= IMPORT_ROW_MAX_BYTES;

export const putImportRows = (
  db: CellDb,
  jobId: string,
  kind: string,
  rows: readonly ImportRow[],
): void => {
  const values = rows.map((row) => ({
    idx: row.idx,
    jobId,
    json: JSON.stringify(row.value),
    kind,
  }));
  for (const chunk of insertChunks(planRows, values)) {
    db.insert(planRows)
      .values(chunk)
      .onConflictDoUpdate({
        set: { json: excluded(planRows.json) },
        target: [planRows.jobId, planRows.kind, planRows.idx],
      })
      .run();
  }
};

// a kind's rows from `from`, at most `limit`, in order
export const importRows = <T>(
  db: CellDb,
  jobId: string,
  kind: string,
  page: { readonly from: number; readonly limit: number },
  schema: z.ZodType<T>,
): { readonly idx: number; readonly value: T }[] =>
  db
    .select({ idx: planRows.idx, json: planRows.json })
    .from(planRows)
    .where(and(eq(planRows.jobId, jobId), eq(planRows.kind, kind), gte(planRows.idx, page.from)))
    .orderBy(asc(planRows.idx))
    .limit(page.limit)
    .all()
    .map((row) => ({ idx: row.idx, value: schema.parse(JSON.parse(row.json)) }));

export const dropImportRows = (db: CellDb, jobId: string, kind: string): void => {
  db.delete(planRows)
    .where(and(eq(planRows.jobId, jobId), eq(planRows.kind, kind)))
    .run();
};
