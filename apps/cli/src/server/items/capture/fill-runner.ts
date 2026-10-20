// the fill worker, run on demand: spawned by the first job, retired after a minute with nothing to
// do, and killed when a job runs past its 30 s, since a page that wedges the extractor would
// otherwise hold every later fill. The worker reads one job at a time, so the runner hands it one
// at a time: a job's 30 s are its own, and the jobs behind one that wedged or crashed the worker go
// to a fresh one rather than failing with it. A suite hands the capture an inline runner instead
// (CapturePorts.runner), over the same jobs.

import { Worker } from "node:worker_threads";
import { z } from "zod";

import { resolveWorkerEntry } from "../../worker-entry";
import { fillAnswerSchema } from "./fill-protocol";
import type { FillAnswer, FillJobInput, FillResult } from "./fill-protocol";

export interface FillRunner {
  // a worker that died, timed out or spoke out of protocol answers `failed`; this never rejects
  run: (job: FillJobInput) => Promise<FillResult>;
  dispose: () => Promise<void>;
}

export interface FillRunnerOptions {
  // a job's own budget, from when the worker is handed it: 30 s unless a suite says otherwise
  jobTimeoutMs?: (job: FillJobInput) => number;
  idleRetireMs?: number;
  // each worker started, for a suite to tell a fresh one from the last
  onSpawn?: () => void;
}

const JOB_TIMEOUT_MS = 30_000;
const IDLE_RETIRE_MS = 60_000;

interface Job {
  id: number;
  input: FillJobInput;
  resolve: (result: FillResult) => void;
}

const failed = (reason: string): FillResult => ({ kind: "failed", reason });

const stripId = ({ id: _id, ...result }: FillAnswer): FillResult => result;

export const createFillRunner = (options: FillRunnerOptions = {}): FillRunner => {
  const budgetOf = options.jobTimeoutMs ?? (() => JOB_TIMEOUT_MS);
  const idleRetireMs = options.idleRetireMs ?? IDLE_RETIRE_MS;
  let worker: Worker | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let nextId = 0;
  let disposed = false;
  const queued: Job[] = [];
  // the one job the worker holds, and the timer that retires it past its budget
  let current: { job: Job; worker: Worker; timer: NodeJS.Timeout } | null = null;

  const armIdle = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      const idle = worker;
      if (idle !== null && current === null && queued.length === 0) {
        worker = null;
        void idle.terminate();
      }
    }, idleRetireMs);
    idleTimer.unref();
  };

  // the job the worker held, answered; the caller hands over the next one
  const finish = (result: FillResult): void => {
    const held = current;
    if (held === null) {
      return;
    }
    current = null;
    clearTimeout(held.timer);
    held.job.resolve(result);
  };

  // a worker reports its death twice ('error', then 'exit'); only the current one is retired, with
  // the one job it held. True when it was
  const retire = (spawned: Worker, reason: string): boolean => {
    if (worker !== spawned) {
      return false;
    }
    worker = null;
    void spawned.terminate();
    if (current?.worker === spawned) {
      finish(failed(reason));
    }
    return true;
  };

  // `handNext` hands over the job after the one a message or a death settled
  const spawn = (handNext: () => void): Worker => {
    const entry = resolveWorkerEntry(import.meta.dirname, "item-fill-worker");
    const spawned = new Worker(entry.path, entry.options);
    options.onSpawn?.();
    spawned.on("message", (message) => {
      const parsed = fillAnswerSchema.safeParse(message);
      if (!parsed.success) {
        if (
          retire(
            spawned,
            `the fill worker answered out of protocol: ${z.prettifyError(parsed.error)}`,
          )
        ) {
          handNext();
        }
        return;
      }
      if (current?.worker === spawned && current.job.id === parsed.data.id) {
        finish(stripId(parsed.data));
        handNext();
      }
    });
    spawned.on("error", (error: Error) => {
      if (retire(spawned, `the fill worker failed: ${error.message}`)) {
        handNext();
      }
    });
    spawned.on("exit", (code: number) => {
      if (retire(spawned, `the fill worker exited with code ${code}`)) {
        handNext();
      }
    });
    return spawned;
  };

  const handOver = (): void => {
    if (current !== null || disposed) {
      return;
    }
    const job = queued.shift();
    if (job === undefined) {
      worker?.unref();
      armIdle();
      return;
    }
    const held = worker ?? spawn(handOver);
    worker = held;
    held.ref();
    const timer = setTimeout(() => {
      // the worker is stuck on this page: it goes, and the jobs behind it go to a fresh one
      if (retire(held, "the page took too long to read")) {
        handOver();
      }
    }, budgetOf(job.input));
    current = { job, timer, worker: held };
    held.postMessage({ ...job.input, id: job.id });
  };

  return {
    async dispose() {
      disposed = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      const stopped = failed("the fill worker was stopped");
      const held = current;
      current = null;
      if (held !== null) {
        clearTimeout(held.timer);
        held.job.resolve(stopped);
      }
      for (const job of queued.splice(0)) {
        job.resolve(stopped);
      }
      const running = worker;
      worker = null;
      await running?.terminate();
    },

    async run(input) {
      if (disposed) {
        return failed("the fill worker was stopped");
      }
      const answered = Promise.withResolvers<FillResult>();
      queued.push({ id: nextId, input, resolve: answered.resolve });
      nextId += 1;
      handOver();
      return await answered.promise;
    },
  };
};

// the same jobs on the calling thread, for a suite: no worker, no timeout
export const inlineFillRunner = (runFillJob: (job: FillJobInput) => FillResult): FillRunner => ({
  dispose: async () => {
    await Promise.resolve();
  },
  run: async (job) => await Promise.resolve(runFillJob(job)),
});
