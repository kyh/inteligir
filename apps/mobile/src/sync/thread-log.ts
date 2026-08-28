// Executing a planned page against RN storage. The plan itself is the wire's
// own (`@repo/api/cloud/sync/plan-page`), shared with the desktop client; this
// is the half that writes, and the store it writes into is the phone's.

import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import type { SyncStore } from "./sync-store";

/** Each apply lands its group and the cursor together, each skip moves the
 *  cursor alone. */
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
