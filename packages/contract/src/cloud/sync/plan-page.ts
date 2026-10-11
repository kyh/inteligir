// one planner for every client: two would be two answers to "did this row move the
// cursor?". a skip is a step of its own because the cursor still has to move past those rows.

import { threadEventSchema } from "@repo/domain/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { SyncEventRow } from "./sync-schema";

export interface PlannedLogRow {
  event: ThreadEvent;
  origin: { deviceId: string; deviceSeq: number };
  // per row, not per group: a client retrying a refused group one row at a time commits each position
  seq: number;
}

export type LogPlanStep =
  | { kind: "apply"; threadId: string; rows: PlannedLogRow[] }
  // firstUnparsed: the lowest row in the run this build's grammar refused, which a client that
  // keeps its cursor records so a later build can pull it again. never one of this device's own.
  | { kind: "skip"; cursor: number; firstUnparsed: number | null };

export interface LogPlan {
  steps: LogPlanStep[];
  skipped: readonly string[];
}

const skipThrough = (steps: LogPlanStep[], seq: number, unparsed: number | null): void => {
  const last = steps.at(-1);
  if (last?.kind === "skip") {
    last.cursor = seq;
    last.firstUnparsed ??= unparsed;
    return;
  }
  steps.push({ cursor: seq, firstUnparsed: unparsed, kind: "skip" });
};

// every id the client has signed in as, not only the current one: signing in again mints a new
// id, and the replayed log still carries the rows written under the old ones.
export const planPage = (
  rows: readonly SyncEventRow[],
  ownDeviceIds: ReadonlySet<string>,
): LogPlan => {
  const steps: LogPlanStep[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    // this client already holds its own rows; re-appending would double them
    if (ownDeviceIds.has(row.deviceId)) {
      skipThrough(steps, row.seq, null);
      continue;
    }
    const parsed = threadEventSchema.safeParse(row.event);
    if (!parsed.success) {
      skipped.push(`log row ${row.seq}: not a thread event this build understands`);
      skipThrough(steps, row.seq, row.seq);
      continue;
    }
    // the cloud never reads a body, so the envelope can disagree with it, and an apply keyed by
    // one would file the event under the other. no later grammar reads the row differently, so it
    // is not recorded for a rewind.
    if (parsed.data.threadId !== row.threadId) {
      skipped.push(
        `log row ${row.seq}: filed under thread ${row.threadId} but carries an event for ${parsed.data.threadId}`,
      );
      skipThrough(steps, row.seq, null);
      continue;
    }
    const planned: PlannedLogRow = {
      event: parsed.data,
      origin: { deviceId: row.deviceId, deviceSeq: row.deviceSeq },
      seq: row.seq,
    };
    const last = steps.at(-1);
    if (last?.kind === "apply" && last.threadId === row.threadId) {
      last.rows.push(planned);
      continue;
    }
    steps.push({ kind: "apply", rows: [planned], threadId: row.threadId });
  }
  return { skipped, steps };
};
