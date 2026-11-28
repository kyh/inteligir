import { z } from "zod";

import type { WriteScope } from "./library-store";

export const autoFileJobSchema = z.strictObject({ itemId: z.string().min(1).max(128) });

export type AutoFileJob = z.infer<typeof autoFileJobSchema>;

const AUTO_FILE_SETTLE_MS = 20_000;

export const askAutoFile = async (scope: WriteScope, itemId: string) => {
  const payload: AutoFileJob = { itemId };

  await scope.askJobs([
    { afterMs: AUTO_FILE_SETTLE_MS, id: `auto-file:${itemId}`, kind: "auto-file", payload },
  ]);
};
