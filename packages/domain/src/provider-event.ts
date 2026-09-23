// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// trimmed to what has a producer here; re-vendor an event from bb rather than inventing a shape
// bb already names.

import { z } from "zod";
import {
  getThreadEventScopeTurnId,
  threadEventScopeSchema,
  validateThreadEventScope,
} from "./thread-event-scope";
import { viewContextSchema } from "./view-context";

export const threadEventItemStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "interrupted",
]);
export type ThreadEventItemStatus = z.infer<typeof threadEventItemStatusSchema>;

export const threadEventItemApprovalStatusSchema = z
  .enum(["waiting_for_approval", "denied"])
  .nullable();
export type ThreadEventItemApprovalStatus = z.infer<typeof threadEventItemApprovalStatusSchema>;

export const threadEventTurnStatusSchema = z.enum(["completed", "failed", "interrupted"]);
export type ThreadEventTurnStatus = z.infer<typeof threadEventTurnStatusSchema>;

export const threadEventFileChangeKindSchema = z.enum(["add", "delete", "update"]);

export const threadEventFileChangeSchema = z.object({
  diff: z.string().optional(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().optional(),
  path: z.string(),
});
export type ThreadEventFileChange = z.infer<typeof threadEventFileChangeSchema>;

export const threadEventTokenUsageBreakdownSchema = z.object({
  cachedInputTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
  totalTokens: z.number(),
});
export type ThreadEventTokenUsageBreakdown = z.infer<typeof threadEventTokenUsageBreakdownSchema>;

export const threadEventTokenUsageSchema = z.object({
  last: threadEventTokenUsageBreakdownSchema,
  modelContextWindow: z.number().nullable(),
  total: threadEventTokenUsageBreakdownSchema,
});
export type ThreadEventTokenUsage = z.infer<typeof threadEventTokenUsageSchema>;

export const threadEventItemSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal("userMessage"),
  }),
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal("agentMessage"),
  }),
  z.object({
    content: z.array(z.string()),
    id: z.string(),
    summary: z.array(z.string()),
    type: z.literal("reasoning"),
  }),
  z.object({
    arguments: z.record(z.string(), z.unknown()).optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
    id: z.string(),
    result: z.unknown().optional(),
    server: z.string().optional(),
    status: threadEventItemStatusSchema,
    tool: z.string(),
    type: z.literal("toolCall"),
  }),
  z.object({
    // omitted, never an empty string, when the process produced no output.
    aggregatedOutput: z.string().optional(),
    approvalStatus: threadEventItemApprovalStatusSchema,
    command: z.string(),
    cwd: z.string(),
    durationMs: z.number().optional(),
    exitCode: z.number().optional(),
    id: z.string(),
    status: threadEventItemStatusSchema,
    type: z.literal("commandExecution"),
  }),
  z.object({
    approvalStatus: threadEventItemApprovalStatusSchema,
    changes: z.array(threadEventFileChangeSchema),
    id: z.string(),
    status: threadEventItemStatusSchema,
    type: z.literal("fileChange"),
  }),
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal("plan"),
  }),
]);
export type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
export type ThreadEventItemType = ThreadEventItem["type"];

// summary is the provider's visible thinking and content its raw chain of thought, which codex
// leaves empty; one reading, so the phone and the desktop show a settled item the same text.
export const settledReasoningText = (
  item: Extract<ThreadEventItem, { type: "reasoning" }>,
): string => (item.summary.length > 0 ? item.summary : item.content).join("\n\n");

const unscopedThreadEventSchema = z.discriminatedUnion("type", [
  z.object({
    threadId: z.string(),
    type: z.literal("turn/started"),
  }),
  z.object({
    error: z.object({ message: z.string() }).optional(),
    status: threadEventTurnStatusSchema,
    threadId: z.string(),
    type: z.literal("turn/completed"),
  }),
  z.object({
    item: threadEventItemSchema,
    threadId: z.string(),
    type: z.literal("item/started"),
  }),
  z.object({
    item: threadEventItemSchema,
    threadId: z.string(),
    type: z.literal("item/completed"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    threadId: z.string(),
    type: z.literal("item/agentMessage/delta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    // true replaces the accumulated output instead of appending.
    reset: z.boolean().optional(),
    threadId: z.string(),
    type: z.literal("item/commandExecution/outputDelta"),
  }),
  // codex streams visible thinking as summary deltas; content deltas carry raw chain-of-thought
  // only for models that expose it. both fold into the one reasoning row.
  z.object({
    delta: z.string(),
    itemId: z.string(),
    threadId: z.string(),
    type: z.literal("item/reasoning/summaryTextDelta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    threadId: z.string(),
    type: z.literal("item/reasoning/textDelta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    threadId: z.string(),
    type: z.literal("item/plan/delta"),
  }),
  z.object({
    threadId: z.string(),
    tokenUsage: threadEventTokenUsageSchema,
    type: z.literal("thread/tokenUsage/updated"),
  }),
  z.object({
    detail: z.string().optional(),
    message: z.string(),
    threadId: z.string(),
    type: z.literal("provider/error"),
    willRetry: z.boolean().optional(),
  }),
  z.object({
    text: z.string(),
    threadId: z.string(),
    type: z.literal("client/turn/requested"),
    // a local addition to bb's shape, beside `text` rather than folded into it; no migration,
    // since events.data is free-form json re-parsed through this schema.
    viewContext: viewContextSchema.optional(),
  }),
]);

const scopedEventDataSchema = z.object({
  scope: threadEventScopeSchema,
});

export const threadEventSchema = unscopedThreadEventSchema
  .and(scopedEventDataSchema)
  .superRefine((event, ctx) => {
    const result = validateThreadEventScope({ scope: event.scope, type: event.type });
    if (!result.valid) {
      ctx.addIssue({
        code: "custom",
        message: result.message ?? "Invalid thread event scope",
        path: ["scope"],
      });
    }
  });
export type ThreadEvent = z.infer<typeof threadEventSchema>;
export type ThreadEventType = ThreadEvent["type"];

export interface ThreadEventItemRef {
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
}

// a delta names only the item id; its kind is on the item/started row.
export const getThreadEventItemRef = (event: ThreadEvent): ThreadEventItemRef => {
  switch (event.type) {
    case "item/started":
    case "item/completed": {
      return { itemId: event.item.id, itemKind: event.item.type };
    }
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta": {
      return { itemId: event.itemId, itemKind: null };
    }
    case "client/turn/requested":
    case "provider/error":
    case "thread/tokenUsage/updated":
    case "turn/completed":
    case "turn/started": {
      return { itemId: null, itemKind: null };
    }
    // no default
  }
};

export type ThreadEventDelta = Extract<ThreadEvent, { delta: string }>;

export const isThreadEventDelta = (event: ThreadEvent): event is ThreadEventDelta => {
  switch (event.type) {
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/plan/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      return true;
    }
    case "client/turn/requested":
    case "item/completed":
    case "item/started":
    case "provider/error":
    case "thread/tokenUsage/updated":
    case "turn/completed":
    case "turn/started": {
      return false;
    }
    // no default
  }
};

// a reset replaces what came before it, so it opens a run rather than joining one; the appends
// after it join it and fold to the same text.
const joinsRun = (run: ThreadEventDelta, next: ThreadEventDelta): boolean =>
  next.type === run.type &&
  next.itemId === run.itemId &&
  next.threadId === run.threadId &&
  getThreadEventScopeTurnId(next.scope) === getThreadEventScopeTurnId(run.scope) &&
  !(next.type === "item/commandExecution/outputDelta" && next.reset === true);

export interface DeltaRunLimit {
  maxBytes: number;
  // utf-8 bytes of the value's json, a text's quotes included.
  jsonBytes: (value: ThreadEventDelta | string) => number;
}

const QUOTE_BYTES = 2;

const appendDelta = (run: ThreadEventDelta, next: ThreadEventDelta): ThreadEventDelta => ({
  ...run,
  delta: run.delta + next.delta,
});

// every fold concatenates an item's deltas, so a run of adjacent ones is stored as one row rather
// than one per token. a join that would take the row past `maxBytes` starts the next run instead.
// a run grows by at most what the joined text adds, so a burst measures each event once rather
// than the whole run at every join.
export const mergeAdjacentDeltas = (
  events: readonly ThreadEvent[],
  limit: DeltaRunLimit,
): ThreadEvent[] => {
  const merged: ThreadEvent[] = [];
  let run: { event: ThreadEventDelta; bytes: number } | null = null;
  for (const event of events) {
    if (!isThreadEventDelta(event)) {
      merged.push(event);
      run = null;
      continue;
    }
    if (run !== null && joinsRun(run.event, event)) {
      const bytes: number = run.bytes + limit.jsonBytes(event.delta) - QUOTE_BYTES;
      if (bytes <= limit.maxBytes) {
        const joined = appendDelta(run.event, event);
        merged[merged.length - 1] = joined;
        run = { bytes, event: joined };
        continue;
      }
    }
    merged.push(event);
    run = { bytes: limit.jsonBytes(event), event };
  }
  return merged;
};
