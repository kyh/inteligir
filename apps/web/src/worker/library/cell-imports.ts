// An import, run by the cell as a job: `library.imports.start` names a file the device uploaded
// (`/v1/blobs`) and what it is, and the alarm runs the job a page at a time
// (`./cell-import-raindrop`, `./cell-import-markdown`), each run ending well inside an alarm's
// limits and asking for the next, so a large import never holds the cell and resumes where it
// stood after an eviction. Every item it adds joins one change set, closed when the job ends; the
// file it read is let go then, unless an item names it.

import { readBlobRow, releaseFile } from "./cell-blobs";
import { apart } from "./cell-import-host";
import type { ImportHost, StepOutcome } from "./cell-import-host";
import {
  dropImportRuns,
  importJobIdOf,
  insertImportJob,
  readImportJob,
  runImportNext,
  stopImport,
} from "./cell-import-jobs";
import type { ImportJob, ImportSource } from "./cell-import-jobs";
import { stepMarkdown } from "./cell-import-markdown";
import { RAINDROP_MAX_BYTES, stepRaindrop } from "./cell-import-raindrop";
import type { CellIds } from "./cell-ids";
import { dueJobs, retryJob } from "./cell-jobs";
import type { LandingScope } from "./cell-landing";
import { logJobFailure } from "./cell-library";
import { refuse } from "./cell-refusal";

// a run that throws is tried again, later each time, and the job stops after this many
const ATTEMPTS_MAX = 5;

const STOPPED =
  "The import stopped because something went wrong reading the file. Try importing it again.";

// a job for the file the device uploaded, its first run at once
export const startImport = (
  scope: LandingScope,
  ids: CellIds,
  input: { readonly sha: string; readonly source: ImportSource },
): ImportJob => {
  const file = readBlobRow(scope.storage, input.sha);
  if (file === null) {
    return refuse({ kind: "blob-missing", shas: [input.sha] });
  }
  if (input.source === "raindrop" && file.bytes > RAINDROP_MAX_BYTES) {
    return refuse({ kind: "too-large" });
  }
  return insertImportJob(scope.storage, { id: ids.item(), ...input }, scope.now);
};

// stops after the page it is on; what it added stays, and its change set closes on the next run
export const cancelImport = (scope: LandingScope, id: string): ImportJob => {
  const job = readImportJob(scope.storage, id);
  if (job === null) {
    return refuse({ kind: "not-found" });
  }
  if (job.state === "running") {
    stopImport(scope.storage, id, { message: null, state: "cancelled" }, scope.now);
    runImportNext(scope.storage, id, scope.now);
  }
  return readImportJob(scope.storage, id) ?? job;
};

const readJob = (host: ImportHost, id: string): ImportJob | null => {
  const read = host.library.read((sql) => readImportJob(sql, id));
  return read.ok ? read.value : null;
};

// an ended job's set closed, its plan let go, and the file it read with it, unless an item names
// that file or another import still reads it
const finish = (host: ImportHost, id: string): void => {
  const job = readJob(host, id);
  const setId = job?.changeSetId ?? null;
  if (setId !== null) {
    host.library.closeChangeSet(setId);
  }
  apart(host.library, (scope) => {
    dropImportRuns(scope.storage, id);
    const readers = scope.storage.all(
      "SELECT id FROM import_jobs WHERE sha = ? AND state = 'running' AND id != ?",
      [job?.sha ?? "", id],
    );
    if (job !== null && readers.length === 0) {
      releaseFile(scope.storage, job.sha, { now: scope.now, seq: scope.seq });
    }
  });
};

const settle = (host: ImportHost, job: ImportJob, outcome: StepOutcome): void => {
  if (outcome.kind === "more") {
    apart(host.library, (scope) => {
      runImportNext(scope.storage, job.id, scope.now);
    });
    return;
  }
  apart(host.library, (scope) => {
    stopImport(
      scope.storage,
      job.id,
      outcome.kind === "done"
        ? { message: null, state: "done" }
        : { message: outcome.message, state: "failed" },
      scope.now,
    );
  });
  finish(host, job.id);
};

const runOne = async (host: ImportHost, id: string): Promise<void> => {
  const job = readJob(host, id);
  if (job === null) {
    apart(host.library, (scope) => {
      dropImportRuns(scope.storage, id);
    });
    return;
  }
  if (job.state !== "running") {
    finish(host, id);
    return;
  }
  const outcome =
    job.source === "raindrop" ? await stepRaindrop(host, job) : await stepMarkdown(host, job);
  settle(host, job, outcome);
};

// every import due: one run each, a run that throws tried again later, and a job that keeps
// throwing stopped with the reason said
export const runImports = async (host: ImportHost): Promise<void> => {
  const due = host.library.read((sql) => dueJobs(sql, host.now(), ["import"]));
  if (!due.ok) {
    return;
  }
  for (const alarmJob of due.value) {
    const id = importJobIdOf(alarmJob.payload);
    try {
      await runOne(host, id);
    } catch (error) {
      logJobFailure(alarmJob, error);
      const stopping = alarmJob.attempts + 1 >= ATTEMPTS_MAX;
      apart(host.library, (scope) => {
        if (stopping) {
          stopImport(scope.storage, id, { message: STOPPED, state: "failed" }, scope.now);
        }
        retryJob(scope.storage, alarmJob, scope.now);
      });
      if (stopping) {
        finish(host, id);
      }
    }
  }
};
