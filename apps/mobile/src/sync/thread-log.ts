import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import type { SyncStore } from "./sync-store";

export const applyPlan = (store: SyncStore, steps: readonly LogPlanStep[]): void => {
  for (const step of steps) {
    if (step.kind === "apply") {
      const cursor = step.rows.at(-1)?.seq;
      if (cursor === undefined) {
        continue;
      }
      store.applyThreadEvents({ cursor, rows: step.rows, threadId: step.threadId });
    } else {
      store.writeCursor(step.cursor);
    }
  }
};
