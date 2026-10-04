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

// a row whose text only grew moves by what it gained: a thought or a message streams a token at a
// time, and resending the whole text for each would cost bytes quadratic in its length. fromLength
// is the held text's length, so an append onto any other text refetches.
const timelineTextAppendSchema = z.object({
  fromLength: z.number().int().nonnegative(),
  id: z.string(),
  sourceSeqEnd: z.number().int(),
  text: z.string(),
});
type TimelineTextAppend = z.infer<typeof timelineTextAppendSchema>;

// a held turn moves by what its own events set and the children that changed, never whole: it
// carries every command, tool call and thought of its turn, so one streamed token would resend all
// of them. childOrder is omitted, like rowOrder, when order and membership held.
const timelineTurnPatchSchema = timelineTurnRowSchema
  .pick({ completedAt: true, id: true, sourceSeqEnd: true, status: true })
  .extend({
    childOrder: z.array(z.string()).optional(),
    textAppends: z.array(timelineTextAppendSchema),
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
  textAppends: z.array(timelineTextAppendSchema),
  tokenUsage: threadEventTokenUsageSchema.nullable(),
  turnPatches: z.array(timelineTurnPatchSchema),
  upsertRows: z.array(timelineRowSchema),
});
export type TimelineDelta = z.infer<typeof timelineDeltaSchema>;

type TimelineTextRow = TimelineConversationRow | TimelineReasoningWorkRow | TimelinePlanWorkRow;

const isTextRow = (row: TimelineRow): row is TimelineTextRow =>
  row.kind === "conversation" ||
  (row.kind === "work" && (row.workKind === "reasoning" || row.workKind === "plan"));

// what a text row is besides its text and how far its events reached; key order is the fold's, the
// same for both sides of one delta.
const textRowRest = (row: TimelineTextRow): string =>
  JSON.stringify({ ...row, sourceSeqEnd: 0, text: "" });

const textAppend = (held: TimelineRow | undefined, row: TimelineRow): TimelineTextAppend | null =>
  held !== undefined &&
  isTextRow(held) &&
  isTextRow(row) &&
  row.text.startsWith(held.text) &&
  textRowRest(held) === textRowRest(row)
    ? {
        fromLength: held.text.length,
        id: row.id,
        sourceSeqEnd: row.sourceSeqEnd,
        text: row.text.slice(held.text.length),
      }
    : null;

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

// what moved since the base: a row whose text only grew as an append, any other as itself
interface ChangedRows<Row> {
  textAppends: TimelineTextAppend[];
  upserts: Row[];
}

const changedRows = <Row extends TimelineRow>(
  held: ReadonlyMap<string, TimelineRow>,
  rows: readonly Row[],
  through: number | null,
): ChangedRows<Row> => {
  const textAppends: TimelineTextAppend[] = [];
  const upserts: Row[] = [];
  for (const row of rows) {
    const heldRow = held.get(row.id);
    if (isUnchanged(heldRow, row, through)) {
      continue;
    }
    const append = textAppend(heldRow, row);
    if (append === null) {
      upserts.push(row);
    } else {
      textAppends.push(append);
    }
  }
  return { textAppends, upserts };
};

const turnPatch = (
  held: TimelineTurnRow,
  row: TimelineTurnRow,
  through: number,
): TimelineTurnPatch => {
  const { textAppends, upserts } = changedRows(byId(held.children), row.children, through);
  const patch: TimelineTurnPatch = {
    completedAt: row.completedAt,
    id: row.id,
    sourceSeqEnd: row.sourceSeqEnd,
    status: row.status,
    textAppends,
    upsertChildren: upserts,
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
  const unpatched: TimelineRow[] = [];
  const turnPatches: TimelineTurnPatch[] = [];
  for (const row of current.rows) {
    const held = heldRows.get(row.id);
    if (through !== null && held?.kind === "turn" && row.kind === "turn") {
      if (row.sourceSeqEnd > through) {
        turnPatches.push(turnPatch(held, row, through));
      }
      continue;
    }
    unpatched.push(row);
  }
  const { textAppends, upserts } = changedRows(heldRows, unpatched, through);
  const rowOrder = movedOrder(base.rows, current.rows);
  const delta = {
    fromSequence: base.maxSequence,
    maxSequence: current.maxSequence,
    textAppends,
    tokenUsage: current.tokenUsage,
    turnPatches,
    upsertRows: upserts,
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

// null when an append names a row the list lacks, or a text of another length than it grew from
const appendTexts = <Row extends TimelineRow>(
  rows: readonly Row[],
  appends: readonly TimelineTextAppend[],
): Row[] | null => {
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const appended = [...rows];
  for (const append of appends) {
    const index = indexById.get(append.id);
    const row = index === undefined ? undefined : appended[index];
    if (
      index === undefined ||
      row === undefined ||
      !isTextRow(row) ||
      row.text.length !== append.fromLength
    ) {
      return null;
    }
    appended[index] = { ...row, sourceSeqEnd: append.sourceSeqEnd, text: row.text + append.text };
  }
  return appended;
};

// null means refetch in full: the base does not match, a patched turn is not held, a row is
// neither held nor sent, or an append does not fit the held text
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
    const merged = mergeRows(turn.children, patch.upsertChildren, patch.childOrder);
    const children = merged === null ? null : appendTexts(merged, patch.textAppends);
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
  const merged = mergeRows(held.rows, [...patchedTurns, ...delta.upsertRows], delta.rowOrder);
  const rows = merged === null ? null : appendTexts(merged, delta.textAppends);
  return rows === null
    ? null
    : { maxSequence: delta.maxSequence, rows, tokenUsage: delta.tokenUsage };
};
