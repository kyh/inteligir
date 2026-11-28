import { z } from "zod";

import type { WriteScope } from "./library-store";

export const meaningJobSchema = z.strictObject({});

export type MeaningJob = z.infer<typeof meaningJobSchema>;

const MEANING_SETTLE_MS = 30_000;

export const askMeaning = async (scope: WriteScope, afterMs = MEANING_SETTLE_MS) => {
  await scope.askJobs([{ afterMs, id: "meaning", kind: "meaning", payload: {} }]);
};
