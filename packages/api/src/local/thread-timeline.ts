// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import {
  threadEventFileChangeKindSchema,
  threadEventItemApprovalStatusSchema,
  threadEventTokenUsageSchema,
} from "@repo/domain/provider-event";
import { viewContextSchema } from "@repo/domain/view-context";
import { z } from "zod";

export const timelineRowStatusValues = ["pending", "completed", "error", "interrupted"] as const;
export const timelineRowStatusSchema = z.enum(timelineRowStatusValues);
export type TimelineRowStatus = z.infer<typeof timelineRowStatusSchema>;

export const timelineRowBaseSchema = z.object({
  createdAt: z.number(),
  id: z.string(),
  sourceSeqEnd: z.number().int(),
  sourceSeqStart: z.number().int(),
  threadId: z.string(),
  turnId: z.string().nullable(),
});
export type TimelineRowBase = z.infer<typeof timelineRowBaseSchema>;

export const timelineConversationRowSchema = timelineRowBaseSchema.extend({
  kind: z.literal("conversation"),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  // nullable rather than optional: every constructor of a conversation row has to answer
  viewContext: viewContextSchema.nullable(),
});
export type TimelineConversationRow = z.infer<typeof timelineConversationRowSchema>;

const timelineWorkRowBaseSchema = timelineRowBaseSchema.extend({
  kind: z.literal("work"),
  status: timelineRowStatusSchema,
});

export const timelineCommandWorkRowSchema = timelineWorkRowBaseSchema.extend({
  approvalStatus: threadEventItemApprovalStatusSchema,
  command: z.string(),
  cwd: z.string().nullable(),
  exitCode: z.number().nullable(),
  output: z.string(),
  workKind: z.literal("command"),
});
export type TimelineCommandWorkRow = z.infer<typeof timelineCommandWorkRowSchema>;

export const timelineToolWorkRowSchema = timelineWorkRowBaseSchema.extend({
  error: z.string().nullable(),
  result: z.string().nullable(),
  toolArgs: z.record(z.string(), z.unknown()).nullable(),
  toolName: z.string(),
  workKind: z.literal("tool"),
});
export type TimelineToolWorkRow = z.infer<typeof timelineToolWorkRowSchema>;

export const timelineFileChangeSchema = z.object({
  diff: z.string().nullable(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().nullable(),
  path: z.string(),
});
export type TimelineFileChange = z.infer<typeof timelineFileChangeSchema>;

export const timelineFileChangeWorkRowSchema = timelineWorkRowBaseSchema.extend({
  approvalStatus: threadEventItemApprovalStatusSchema,
  changes: z.array(timelineFileChangeSchema),
  workKind: z.literal("file-change"),
});
export type TimelineFileChangeWorkRow = z.infer<typeof timelineFileChangeWorkRowSchema>;

export const timelineReasoningWorkRowSchema = timelineWorkRowBaseSchema.extend({
  text: z.string(),
  workKind: z.literal("reasoning"),
});
export type TimelineReasoningWorkRow = z.infer<typeof timelineReasoningWorkRowSchema>;

export const timelinePlanWorkRowSchema = timelineWorkRowBaseSchema.extend({
  text: z.string(),
  workKind: z.literal("plan"),
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
  detail: z.string().nullable(),
  kind: z.literal("error"),
  message: z.string(),
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
  // a turn holds rows and a row may be a turn: the cycle only resolves at parse time, which is
  // what `z.lazy` defers to and why this reference cannot be reordered away
  // oxlint-disable-next-line no-use-before-define -- mutually recursive schema, deferred by z.lazy
  children: z.array(z.lazy(() => timelineRowSchema)),
  completedAt: z.number().nullable(),
  kind: z.literal("turn"),
  status: timelineRowStatusSchema,
  turnId: z.string().min(1),
});

export const timelineRowSchema: z.ZodType<TimelineRow> = z.union([
  timelineConversationRowSchema,
  timelineWorkRowSchema,
  timelineErrorRowSchema,
  timelineTurnRowSchema,
]);

export const threadTimelineSchema = z.object({
  maxSequence: z.number().int().nonnegative(),
  rows: z.array(timelineRowSchema),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
});
export type ThreadTimeline = z.infer<typeof threadTimelineSchema>;

// fromSequence names the base timeline; applyTimelineDelta refuses a delta whose base is not
// the held one. rowOrder is omitted when order and membership are unchanged, so a streaming
// row does not resend every id.
export const timelineDeltaSchema = z.object({
  fromSequence: z.number().int().nonnegative(),
  maxSequence: z.number().int().nonnegative(),
  rowOrder: z.array(z.string()).optional(),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
  upsertRows: z.array(timelineRowSchema),
});
export type TimelineDelta = z.infer<typeof timelineDeltaSchema>;

export const computeTimelineDelta = (
  base: ThreadTimeline,
  current: ThreadTimeline,
): TimelineDelta => {
  // when current extends base, a row whose sourceSeqEnd has not passed base.maxSequence is
  // identical to base's, and serializing it to learn that is this function's whole cost on a
  // long thread; for a shorter current the reasoning inverts, so the filter stands down
  const extendsBase = current.maxSequence >= base.maxSequence;
  const prevById = new Map<string, TimelineRow>();
  for (const row of base.rows) {
    prevById.set(row.id, row);
  }
  const upsertRows: TimelineRow[] = [];
  const rowOrder: string[] = [];
  let orderChanged = base.rows.length !== current.rows.length;
  for (const row of current.rows) {
    rowOrder.push(row.id);
    if (base.rows[rowOrder.length - 1]?.id !== row.id) {
      orderChanged = true;
    }
    if (extendsBase && row.sourceSeqEnd <= base.maxSequence && prevById.has(row.id)) {
      continue;
    }
    const previous = prevById.get(row.id);
    if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(row)) {
      upsertRows.push(row);
    }
  }
  const envelope = {
    fromSequence: base.maxSequence,
    maxSequence: current.maxSequence,
    tokenUsage: current.tokenUsage,
  };
  return orderChanged ? { ...envelope, rowOrder, upsertRows } : { ...envelope, upsertRows };
};

// null means refetch in full: the base does not match, or a row is neither held nor sent
export const applyTimelineDelta = (
  held: ThreadTimeline,
  delta: TimelineDelta,
): ThreadTimeline | null => {
  if (delta.fromSequence !== held.maxSequence) {
    return null;
  }
  const byId = new Map<string, TimelineRow>();
  for (const row of held.rows) {
    byId.set(row.id, row);
  }
  for (const row of delta.upsertRows) {
    byId.set(row.id, row);
  }
  const rows: TimelineRow[] = [];
  const rowOrder = delta.rowOrder ?? held.rows.map((row) => row.id);
  for (const id of rowOrder) {
    const row = byId.get(id);
    if (row === undefined) {
      return null;
    }
    rows.push(row);
  }
  return { maxSequence: delta.maxSequence, rows, tokenUsage: delta.tokenUsage };
};
