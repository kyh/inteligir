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
  // the notes a user message attached; empty on every other row
  contextPaths: z.array(z.string()),
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

// a command row carries what the panel draws, its first lines and the count of the rest, because
// every delta that touches the row resends it; the whole output stays in the event log
export const COMMAND_OUTPUT_LINES = 40;
// the panel cuts a line at its width, so past this a line is bytes nobody sees, and one minified
// blob on a single line would otherwise carry the whole output again
export const COMMAND_OUTPUT_LINE_CHARS = 240;

export const timelineCommandWorkRowSchema = timelineWorkRowBaseSchema.extend({
  approvalStatus: threadEventItemApprovalStatusSchema,
  command: z.string(),
  cwd: z.string().nullable(),
  exitCode: z.number().nullable(),
  outputHead: z.array(z.string().max(COMMAND_OUTPUT_LINE_CHARS)).max(COMMAND_OUTPUT_LINES),
  outputLineCount: z.number().int().nonnegative(),
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

// the fold nests a turn's work and its errors under it and nothing else, so a turn never holds a
// turn and the grammar needs no recursion
const timelineTurnChildSchema = z.discriminatedUnion("kind", [
  timelineWorkRowSchema,
  timelineErrorRowSchema,
]);
export type TimelineTurnChild = z.infer<typeof timelineTurnChildSchema>;

export const timelineTurnRowSchema = timelineRowBaseSchema.extend({
  children: z.array(timelineTurnChildSchema),
  completedAt: z.number().nullable(),
  kind: z.literal("turn"),
  status: timelineRowStatusSchema,
  turnId: z.string().min(1),
});
export type TimelineTurnRow = z.infer<typeof timelineTurnRowSchema>;

export const timelineRowSchema = z.discriminatedUnion("kind", [
  timelineConversationRowSchema,
  timelineWorkRowSchema,
  timelineErrorRowSchema,
  timelineTurnRowSchema,
]);
export type TimelineRow = z.infer<typeof timelineRowSchema>;

export const threadTimelineSchema = z.object({
  maxSequence: z.number().int().nonnegative(),
  rows: z.array(timelineRowSchema),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
});
export type ThreadTimeline = z.infer<typeof threadTimelineSchema>;

// a held turn moves by what its own events set and the children that changed, never whole: it
// carries every command, tool call and thought of its turn, so one streamed token would resend all
// of them. childOrder is omitted, like rowOrder, when order and membership held.
const timelineTurnPatchSchema = timelineTurnRowSchema
  .pick({ completedAt: true, id: true, sourceSeqEnd: true, status: true })
  .extend({
    childOrder: z.array(z.string()).optional(),
    upsertChildren: z.array(timelineTurnChildSchema),
  });
type TimelineTurnPatch = z.infer<typeof timelineTurnPatchSchema>;

// fromSequence names the base timeline; applyTimelineDelta refuses a delta whose base is not
// the held one. rowOrder is omitted when order and membership are unchanged, so a streaming
// row does not resend every id.
export const timelineDeltaSchema = z.object({
  fromSequence: z.number().int().nonnegative(),
  maxSequence: z.number().int().nonnegative(),
  rowOrder: z.array(z.string()).optional(),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
  turnPatches: z.array(timelineTurnPatchSchema),
  upsertRows: z.array(timelineRowSchema),
});
export type TimelineDelta = z.infer<typeof timelineDeltaSchema>;

interface Identified {
  id: string;
}

const byId = <Row extends Identified>(rows: readonly Row[]): Map<string, Row> =>
  new Map(rows.map((row) => [row.id, row]));

const movedOrder = (
  held: readonly Identified[],
  current: readonly Identified[],
): string[] | undefined =>
  current.length === held.length && current.every((row, index) => held[index]?.id === row.id)
    ? undefined
    : current.map((row) => row.id);

// `through` is base.maxSequence when current extends base: a held row whose sourceSeqEnd has not
// passed it is identical to base's, and serializing it to learn that is the delta's whole cost on a
// long thread. for a shorter current the reasoning inverts, so `through` is null and every row is
// compared.
const isUnchanged = (
  held: TimelineRow | undefined,
  row: TimelineRow,
  through: number | null,
): boolean =>
  held !== undefined &&
  ((through !== null && row.sourceSeqEnd <= through) ||
    JSON.stringify(held) === JSON.stringify(row));

const turnPatch = (
  held: TimelineTurnRow,
  row: TimelineTurnRow,
  through: number,
): TimelineTurnPatch => {
  const heldChildren = byId(held.children);
  const patch: TimelineTurnPatch = {
    completedAt: row.completedAt,
    id: row.id,
    sourceSeqEnd: row.sourceSeqEnd,
    status: row.status,
    upsertChildren: row.children.filter(
      (child) => !isUnchanged(heldChildren.get(child.id), child, through),
    ),
  };
  const childOrder = movedOrder(held.children, row.children);
  return childOrder === undefined ? patch : { ...patch, childOrder };
};

export const computeTimelineDelta = (
  base: ThreadTimeline,
  current: ThreadTimeline,
): TimelineDelta => {
  const through = current.maxSequence >= base.maxSequence ? base.maxSequence : null;
  const heldRows = byId(base.rows);
  const upsertRows: TimelineRow[] = [];
  const turnPatches: TimelineTurnPatch[] = [];
  for (const row of current.rows) {
    const held = heldRows.get(row.id);
    if (through !== null && held?.kind === "turn" && row.kind === "turn") {
      if (row.sourceSeqEnd > through) {
        turnPatches.push(turnPatch(held, row, through));
      }
      continue;
    }
    if (!isUnchanged(held, row, through)) {
      upsertRows.push(row);
    }
  }
  const rowOrder = movedOrder(base.rows, current.rows);
  const delta = {
    fromSequence: base.maxSequence,
    maxSequence: current.maxSequence,
    tokenUsage: current.tokenUsage,
    turnPatches,
    upsertRows,
  };
  return rowOrder === undefined ? delta : { ...delta, rowOrder };
};

// the held rows stay the same objects unless an upsert replaces them, which is what the panel
// memoizes on; null when an id in the order is neither held nor sent
const mergeRows = <Row extends Identified>(
  held: readonly Row[],
  upserts: readonly Row[],
  order: readonly string[] | undefined,
): Row[] | null => {
  const rowsById = byId(held);
  for (const row of upserts) {
    rowsById.set(row.id, row);
  }
  const merged: Row[] = [];
  for (const id of order ?? held.map((row) => row.id)) {
    const row = rowsById.get(id);
    if (row === undefined) {
      return null;
    }
    merged.push(row);
  }
  return merged;
};

// null means refetch in full: the base does not match, a patched turn is not held, or a row is
// neither held nor sent
export const applyTimelineDelta = (
  held: ThreadTimeline,
  delta: TimelineDelta,
): ThreadTimeline | null => {
  if (delta.fromSequence !== held.maxSequence) {
    return null;
  }
  const heldRows = byId(held.rows);
  const patchedTurns: TimelineTurnRow[] = [];
  for (const patch of delta.turnPatches) {
    const turn = heldRows.get(patch.id);
    if (turn?.kind !== "turn") {
      return null;
    }
    const children = mergeRows(turn.children, patch.upsertChildren, patch.childOrder);
    if (children === null) {
      return null;
    }
    patchedTurns.push({
      ...turn,
      children,
      completedAt: patch.completedAt,
      sourceSeqEnd: patch.sourceSeqEnd,
      status: patch.status,
    });
  }
  const rows = mergeRows(held.rows, [...patchedTurns, ...delta.upsertRows], delta.rowOrder);
  return rows === null
    ? null
    : { maxSequence: delta.maxSequence, rows, tokenUsage: delta.tokenUsage };
};
