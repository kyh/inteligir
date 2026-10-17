// the fill worker's entry, beside the runner that resolves it in a checkout: every message is one
// job, answered with one result. It runs in a thread with no network of its own.

import { parentPort } from "node:worker_threads";
import { z } from "zod";

import { runFillJob } from "./fill/fill-jobs";

const fillJobSchema = z.strictObject({ html: z.string(), id: z.string(), url: z.string() });

const port = parentPort;
if (port === null) {
  throw new Error("item-fill-worker must be started as a worker thread");
}

// PIVOT-STUB(S1): the runner's protocol, its fetch ban and its idle retirement (§4.4 point 4)
port.on("message", (message) => {
  const job = fillJobSchema.safeParse(message);
  if (!job.success) {
    throw new Error(`fill worker: malformed job: ${z.prettifyError(job.error)}`);
  }
  port.postMessage(runFillJob(job.data));
});
