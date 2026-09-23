// the worker's jobs on the calling thread, through the same clone and the same parse the
// worker's answers cross: a worker booted from source costs seconds, and most suites ask what
// the index holds, not which thread built it.

import { runProjectionJob } from "../projection-jobs";
import { projectionAnswerSchema } from "../projection-protocol";
import { createProjector } from "../projector";
import type { Projector } from "../projector";

export const createInlineProjector = (): Projector => {
  let disposed = false;
  return createProjector({
    dispose: async () => {
      disposed = true;
    },
    run: async (job) => {
      if (disposed) {
        throw new Error("the inline projector was disposed");
      }
      return projectionAnswerSchema.parse(structuredClone({ ...runProjectionJob(job), id: 0 }));
    },
  });
};
