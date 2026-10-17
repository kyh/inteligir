// the fill worker's entry, beside the runner that resolves it in a checkout: every message is one
// job, answered with one result. It runs in a thread with no network of its own: `fetch` refuses
// before any job runs, and nothing under fill/ imports a socket (fill/__tests__/no-network.test.ts).

import { parentPort } from "node:worker_threads";
import { z } from "zod";

import { runFillJob } from "./fill/fill-jobs";
import { fillJobSchema } from "./fill-protocol";
import type { FillAnswer } from "./fill-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("item-fill-worker must be started as a worker thread");
}

globalThis.fetch = async () =>
  await Promise.reject(new Error("the fill worker reaches no network"));

// a job that does not parse is a host bug: the worker exits, and the runner fails what it held
port.on("message", (message) => {
  const job = fillJobSchema.safeParse(message);
  if (!job.success) {
    throw new Error(`fill worker: malformed job: ${z.prettifyError(job.error)}`);
  }
  const { id, ...input } = job.data;
  const answer: FillAnswer = { ...runFillJob(input), id };
  port.postMessage(answer);
});
