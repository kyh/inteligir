// a worker: the markdown scan is pure CPU, seconds of it for a large note, and the thread that
// owns better-sqlite3 also answers every request, the ws bus and the watcher's liveness ping.
// a request that does not parse is a host bug and crashes the worker, which fails every job in
// flight.

import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { runProjectionJob } from "./projection-jobs";
import { projectionRequestSchema } from "./projection-protocol";
import type { ProjectionAnswer } from "./projection-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("projection-worker must be started as a worker thread");
}

port.on("message", (message) => {
  const request = projectionRequestSchema.safeParse(message);
  if (!request.success) {
    throw new Error(`projection worker: malformed request: ${z.prettifyError(request.error)}`);
  }
  const answer: ProjectionAnswer = { ...runProjectionJob(request.data), id: request.data.id };
  port.postMessage(answer);
});
