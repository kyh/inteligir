// What a pulled page of the account's merged log becomes BEFORE any of it is
// written — ONE planner for every client of this wire, because two copies of it
// are two answers to "did this row move the cursor?", and the cheapest way for
// them to disagree is a conversation duplicated on one device and not the other.
//
// The plan is built first and executed second on purpose: deciding and writing
// in one loop is where that bookkeeping tangles.
//
// `apply` merges CONSECUTIVE rows for one thread, so a streaming turn's deltas
// land as one write and one invalidation rather than hundreds. `skip` is the
// rest — this device's own rows coming back through the merged log, and rows in
// a grammar this build does not know — and it is a step of its own because the
// cursor still has to move past them.
//
// The planner decides and says what it could not read; it writes nothing and
// logs nothing. Executing a plan belongs to the client, whose store it is.

import { threadEventSchema, type ThreadEvent } from "@repo/domain/provider-event";
import type { SyncEventRow } from "./sync-schema";

/**
 * One planned row, carrying the log row's own identity.
 *
 * `origin` is what makes a re-pull idempotent — a row already applied under
 * `(deviceId, deviceSeq)` is skipped by the store. `seq` is the account-global
 * position it settles, kept PER ROW rather than per group because a client that
 * retries a refused group one row at a time commits each one's position
 * separately.
 */
export interface PlannedLogRow {
  event: ThreadEvent;
  origin: { deviceId: string; deviceSeq: number };
  seq: number;
}

export type LogPlanStep =
  | { kind: "apply"; threadId: string; rows: PlannedLogRow[] }
  | { kind: "skip"; cursor: number };

export interface LogPlan {
  steps: LogPlanStep[];
  /** Rows this build could not read, reported rather than dropped silently. */
  skipped: readonly string[];
}

/** Plan a page against this device's own id. */
export function planPage(rows: readonly SyncEventRow[], deviceId: string): LogPlan {
  const steps: LogPlanStep[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const last = steps.at(-1);
    // This device already holds what it wrote; re-appending would double every
    // event it ever sent.
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
