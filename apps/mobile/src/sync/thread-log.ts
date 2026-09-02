import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import type { SyncStore } from "./sync-store";

export function applyPlan(store: SyncStore, steps: readonly LogPlanStep[]): void {
  for (const step of steps) {
    if (step.kind === "apply") {
      const cursor = step.rows.at(-1)?.seq;
      if (cursor === undefined) continue;
      store.applyThreadEvents({ threadId: step.threadId, rows: step.rows, cursor });
    } else {
      store.writeCursor(step.cursor);
    }
  }
}
