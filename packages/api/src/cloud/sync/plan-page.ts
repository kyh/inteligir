// one planner for every client: two would be two answers to "did this row move the
// cursor?". a skip is a step of its own because the cursor still has to move past those rows.

import { threadEventSchema, type ThreadEvent } from "@repo/domain/provider-event";
import type { SyncEventRow } from "./sync-schema";

export interface PlannedLogRow {
  event: ThreadEvent;
  origin: { deviceId: string; deviceSeq: number };
  // per row, not per group: a client retrying a refused group one row at a time commits each position
  seq: number;
}

export type LogPlanStep =
  | { kind: "apply"; threadId: string; rows: PlannedLogRow[] }
  | { kind: "skip"; cursor: number };

export interface LogPlan {
  steps: LogPlanStep[];
  skipped: readonly string[];
}

export function planPage(rows: readonly SyncEventRow[], deviceId: string): LogPlan {
  const steps: LogPlanStep[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const last = steps.at(-1);
    // this device already holds its own rows; re-appending would double them
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
    const planned: PlannedLogRow = {
      event: parsed.data,
      origin: { deviceId: row.deviceId, deviceSeq: row.deviceSeq },
      seq: row.seq,
    };
    if (last?.kind === "apply" && last.threadId === row.threadId) {
      last.rows.push(planned);
      continue;
    }
    steps.push({ kind: "apply", threadId: row.threadId, rows: [planned] });
  }
  return { steps, skipped };
}
