// Turning a pulled page of the account log into applied thread events — the RN
// twin of apps/app/src/node/cloud/sync-runtime.ts's `planPage`/`applyStep`.
//
// The plan is built first and executed second on purpose: deciding and writing
// in one loop is where the "did this row move the cursor?" bookkeeping tangles,
// and a mis-set cursor is a duplicated conversation. Consecutive rows for one
// thread merge into one apply, so a streaming turn's deltas land as one write and
// one notification rather than hundreds.

import { threadEventSchema } from "@repo/domain/provider-event";
import type { SyncEventRow } from "@repo/cloud-contract/sync";
import type { AppliedRow, SyncStore } from "./sync-store";

export type PlanStep =
  | { kind: "apply"; threadId: string; rows: AppliedRow[] }
  | { kind: "skip"; cursor: number };

export interface PlanPageResult {
  steps: PlanStep[];
  /** Rows this build could not read, reported rather than dropped silently. */
  skipped: readonly string[];
}

/**
 * Plan a page against this device's own id. A row is SKIPPED — its position still
 * moves the cursor — when it is this device's own event coming back through the
 * merged log (re-appending would double every event it ever pushed) or when it
 * is in a grammar this build does not know.
 */
export function planPage(rows: readonly SyncEventRow[], deviceId: string): PlanPageResult {
  const steps: PlanStep[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const last = steps.at(-1);
    const mine = row.deviceId === deviceId;
    const parsed = mine ? null : threadEventSchema.safeParse(row.event);
    if (parsed !== null && !parsed.success) {
      skipped.push(`log row ${row.seq}: not a thread event this build understands`);
    }
    if (parsed === null || !parsed.success) {
      if (last?.kind === "skip") {
        last.cursor = row.seq;
      } else {
        steps.push({ kind: "skip", cursor: row.seq });
      }
      continue;
    }
    const applied: AppliedRow = {
      event: parsed.data,
      origin: { deviceId: row.deviceId, deviceSeq: row.deviceSeq },
      seq: row.seq,
    };
    if (last?.kind === "apply" && last.threadId === row.threadId) {
      last.rows.push(applied);
      continue;
    }
    steps.push({ kind: "apply", threadId: row.threadId, rows: [applied] });
  }
  return { steps, skipped };
}

/** Execute a plan against the store: each apply lands its group and the cursor
 *  together, each skip moves the cursor alone. */
export function applyPlan(store: SyncStore, steps: readonly PlanStep[]): void {
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
