import crypto from "node:crypto";
import { z } from "zod";

import type { TaskRunLog } from "../shared/task";
import { inteligirPath, readJson, writeJson } from "./json-store";

// ---------------------------------------------------------------------------
// Per-run logging — ~/.inteligir/task-runs.json
// ---------------------------------------------------------------------------

const RUNS_PATH = inteligirPath("task-runs.json");

/** Max runs retained to prevent unbounded growth */
const MAX_RUNS = 500;

const RunsSchema = z.array(
  z.object({
    id: z.string(),
    taskId: z.string(),
    startedAt: z.number(),
    durationMs: z.number().nullable(),
    status: z.enum(["running", "completed", "failed"]),
    error: z.string().nullable(),
    resultSummary: z.string().nullable(),
  }),
);

function readRuns(): TaskRunLog[] {
  return readJson(RUNS_PATH, RunsSchema) ?? [];
}

function saveRuns(runs: TaskRunLog[]): void {
  const trimmed = runs.length > MAX_RUNS ? runs.slice(-MAX_RUNS) : runs;
  writeJson(RUNS_PATH, trimmed);
}

export function startRun(taskId: string): TaskRunLog {
  const run: TaskRunLog = {
    id: crypto.randomUUID(),
    taskId,
    startedAt: Date.now(),
    durationMs: null,
    status: "running",
    error: null,
    resultSummary: null,
  };
  const runs = readRuns();
  runs.push(run);
  saveRuns(runs);
  return run;
}

export function completeRun(id: string, resultSummary: string): void {
  const runs = readRuns();
  const run = runs.find((r) => r.id === id);
  if (!run) return;
  run.status = "completed";
  run.durationMs = Date.now() - run.startedAt;
  run.resultSummary = resultSummary;
  saveRuns(runs);
}

export function failRun(id: string, error: string): void {
  const runs = readRuns();
  const run = runs.find((r) => r.id === id);
  if (!run) return;
  run.status = "failed";
  run.durationMs = Date.now() - run.startedAt;
  run.error = error;
  saveRuns(runs);
}
