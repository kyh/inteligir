// the fill worker, run on demand: spawned by the first job, retired after a minute with nothing to
// do, and killed when a job runs past its 30 s, since a page that wedges the extractor would
// otherwise hold every later fill. A suite hands the capture an inline runner instead
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

const JOB_TIMEOUT_MS = 30_000;
const IDLE_RETIRE_MS = 60_000;

interface Waiter {
  resolve: (result: FillResult) => void;
  timer: NodeJS.Timeout;
}

const failed = (reason: string): FillResult => ({ kind: "failed", reason });

const stripId = ({ id: _id, ...result }: FillAnswer): FillResult => result;

export const createFillRunner = (
  options: { jobTimeoutMs?: number; idleRetireMs?: number } = {},
): FillRunner => {
  const jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  const idleRetireMs = options.idleRetireMs ?? IDLE_RETIRE_MS;
  let worker: Worker | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let nextId = 0;
  let disposed = false;
  const waiting = new Map<number, Waiter>();

  const settle = (id: number, result: FillResult): void => {
    const waiter = waiting.get(id);
    if (waiter === undefined) {
      return;
    }
    waiting.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  };

  const failAll = (reason: string): void => {
    for (const id of waiting.keys()) {
      settle(id, failed(reason));
    }
  };

  // a worker reports its death twice ('error', then 'exit'); only the current one is retired
  const retire = (spawned: Worker, reason: string): void => {
    if (worker !== spawned) {
      return;
    }
    worker = null;
    failAll(reason);
    void spawned.terminate();
  };

  const armIdle = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      const current = worker;
      if (current !== null && waiting.size === 0) {
        worker = null;
        void current.terminate();
      }
    }, idleRetireMs);
    idleTimer.unref();
  };

  const spawn = (): Worker => {
    const entry = resolveWorkerEntry(import.meta.dirname, "item-fill-worker");
    const spawned = new Worker(entry.path, entry.options);
    spawned.on("message", (message) => {
      const parsed = fillAnswerSchema.safeParse(message);
      if (!parsed.success) {
        retire(
          spawned,
          `the fill worker answered out of protocol: ${z.prettifyError(parsed.error)}`,
        );
        return;
      }
      settle(parsed.data.id, stripId(parsed.data));
      if (waiting.size === 0) {
        spawned.unref();
        armIdle();
      }
    });
    spawned.on("error", (error: Error) => {
      retire(spawned, `the fill worker failed: ${error.message}`);
    });
    spawned.on("exit", (code: number) => {
      retire(spawned, `the fill worker exited with code ${code}`);
    });
    return spawned;
  };

  return {
    async dispose() {
      disposed = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      failAll("the fill worker was stopped");
      const current = worker;
      worker = null;
      await current?.terminate();
    },

    async run(job) {
      if (disposed) {
        return failed("the fill worker was stopped");
      }
      const current = worker ?? spawn();
      worker = current;
      const id = nextId;
      nextId += 1;
      const answered = Promise.withResolvers<FillResult>();
      const timer = setTimeout(() => {
        // the worker is stuck on this page: it goes, with whatever else it held
        retire(current, "the page took too long to read");
      }, jobTimeoutMs);
      waiting.set(id, { resolve: answered.resolve, timer });
      current.ref();
      current.postMessage({ ...job, id });
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
