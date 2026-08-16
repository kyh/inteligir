// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the rows v1's grammar can produce; bb's full row set also
// carries web activity, approvals, questions, delegation, and workflow rows.

import {
  threadEventFileChangeKindSchema,
  threadEventItemApprovalStatusSchema,
  threadEventTokenUsageSchema,
} from "@repo/domain/provider-event";
import { z } from "zod";

export const timelineRowStatusValues = ["pending", "completed", "error", "interrupted"] as const;
export const timelineRowStatusSchema = z.enum(timelineRowStatusValues);
export type TimelineRowStatus = z.infer<typeof timelineRowStatusSchema>;

export const timelineRowBaseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string().nullable(),
  sourceSeqStart: z.number().int(),
  sourceSeqEnd: z.number().int(),
  createdAt: z.number(),
});
export type TimelineRowBase = z.infer<typeof timelineRowBaseSchema>;

export const timelineConversationRowSchema = timelineRowBaseSchema.extend({
  kind: z.literal("conversation"),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});
export type TimelineConversationRow = z.infer<typeof timelineConversationRowSchema>;

const timelineWorkRowBaseSchema = timelineRowBaseSchema.extend({
  kind: z.literal("work"),
  status: timelineRowStatusSchema,
});

export const timelineCommandWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("command"),
  command: z.string(),
  cwd: z.string().nullable(),
  output: z.string(),
  exitCode: z.number().nullable(),
  approvalStatus: threadEventItemApprovalStatusSchema,
});
export type TimelineCommandWorkRow = z.infer<typeof timelineCommandWorkRowSchema>;

export const timelineToolWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("tool"),
  toolName: z.string(),
  toolArgs: z.record(z.string(), z.unknown()).nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});
export type TimelineToolWorkRow = z.infer<typeof timelineToolWorkRowSchema>;

export const timelineFileChangeSchema = z.object({
  path: z.string(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().nullable(),
  diff: z.string().nullable(),
});
export type TimelineFileChange = z.infer<typeof timelineFileChangeSchema>;

export const timelineFileChangeWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("file-change"),
  changes: z.array(timelineFileChangeSchema),
  approvalStatus: threadEventItemApprovalStatusSchema,
});
export type TimelineFileChangeWorkRow = z.infer<typeof timelineFileChangeWorkRowSchema>;

export const timelineReasoningWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("reasoning"),
  text: z.string(),
});
export type TimelineReasoningWorkRow = z.infer<typeof timelineReasoningWorkRowSchema>;

export const timelinePlanWorkRowSchema = timelineWorkRowBaseSchema.extend({
  workKind: z.literal("plan"),
  text: z.string(),
});
export type TimelinePlanWorkRow = z.infer<typeof timelinePlanWorkRowSchema>;

export const timelineWorkRowSchema = z.discriminatedUnion("workKind", [
  timelineCommandWorkRowSchema,
  timelineToolWorkRowSchema,
  timelineFileChangeWorkRowSchema,
  timelineReasoningWorkRowSchema,
  timelinePlanWorkRowSchema,
]);
export type TimelineWorkRow = z.infer<typeof timelineWorkRowSchema>;

export const timelineErrorRowSchema = timelineRowBaseSchema.extend({
  kind: z.literal("error"),
  message: z.string(),
  detail: z.string().nullable(),
});
export type TimelineErrorRow = z.infer<typeof timelineErrorRowSchema>;

export interface TimelineTurnRow extends TimelineRowBase {
  kind: "turn";
  turnId: string;
  status: TimelineRowStatus;
  completedAt: number | null;
  children: TimelineRow[];
}

export type TimelineRow =
  | TimelineConversationRow
  | TimelineWorkRow
  | TimelineErrorRow
  | TimelineTurnRow;

export const timelineTurnRowSchema: z.ZodType<TimelineTurnRow> = timelineRowBaseSchema.extend({
  kind: z.literal("turn"),
  turnId: z.string().min(1),
  status: timelineRowStatusSchema,
  completedAt: z.number().nullable(),
  children: z.array(z.lazy(() => timelineRowSchema)),
});

export const timelineRowSchema: z.ZodType<TimelineRow> = z.lazy(() =>
  z.union([
    timelineConversationRowSchema,
    timelineWorkRowSchema,
    timelineErrorRowSchema,
    timelineTurnRowSchema,
  ]),
);

export const threadTimelineSchema = z.object({
  rows: z.array(timelineRowSchema),
  /** High-water mark of the projected events; the client's next `afterSequence`. */
  maxSequence: z.number().int().nonnegative(),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
});
export type ThreadTimeline = z.infer<typeof threadTimelineSchema>;

/**
 * Incremental update to a previously-fetched timeline. The server computes it
 * by reprojecting the full timeline (correct by construction — grouping and
 * finalize semantics are preserved) and diffing it against the rows the
 * client's `afterSequence` implies it last received.
 *
 * `upsertRows` carries the full body of every row that was added or changed.
 * `rowOrder`, when present, is the complete, ordered id list of the current
 * timeline, so the client reconstructs exact ordering and membership. It is
 * omitted when both are unchanged, which avoids repeatedly sending every row
 * id while an active row is merely streaming new content.
 */
export const timelineDeltaSchema = z.object({
  upsertRows: z.array(timelineRowSchema),
  rowOrder: z.array(z.string()).optional(),
});
export type TimelineDelta = z.infer<typeof timelineDeltaSchema>;

/**
 * Diff a freshly-projected timeline against the rows the client last held.
 * Pure; used by the server to build a {@link TimelineDelta}.
 */
export function computeTimelineRowDelta(
  prevRows: readonly TimelineRow[],
  currentRows: readonly TimelineRow[],
): TimelineDelta {
  const prevById = new Map<string, string>();
  for (const row of prevRows) {
    prevById.set(row.id, JSON.stringify(row));
  }
  const upsertRows: TimelineRow[] = [];
  const rowOrder: string[] = [];
  let orderChanged = prevRows.length !== currentRows.length;
  for (const row of currentRows) {
    rowOrder.push(row.id);
    if (prevRows[rowOrder.length - 1]?.id !== row.id) {
      orderChanged = true;
    }
    if (prevById.get(row.id) !== JSON.stringify(row)) {
      upsertRows.push(row);
    }
  }
  return orderChanged ? { upsertRows, rowOrder } : { upsertRows };
}

/**
 * Apply a {@link TimelineDelta} to the rows the client currently holds,
 * yielding the new full timeline. Returns `null` when the delta references a
 * row the client neither holds nor was sent (a stale/mismatched base) — the
 * caller should fall back to a full fetch.
 */
export function applyTimelineDelta(
  prevRows: readonly TimelineRow[],
  delta: TimelineDelta,
): TimelineRow[] | null {
  const byId = new Map<string, TimelineRow>();
  for (const row of prevRows) {
    byId.set(row.id, row);
  }
  for (const row of delta.upsertRows) {
    byId.set(row.id, row);
  }
  const result: TimelineRow[] = [];
  const rowOrder = delta.rowOrder ?? prevRows.map((row) => row.id);
  for (const id of rowOrder) {
    const row = byId.get(id);
    if (row === undefined) {
      return null;
    }
    result.push(row);
  }
  return result;
}
