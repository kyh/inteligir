// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// trimmed to what has a producer here; re-vendor an event from bb rather than inventing a shape
// bb already names.

import { z } from "zod";
import { threadEventScopeSchema, threadScopeSchema, turnScopeSchema } from "./thread-event-scope";
import { MAX_THREAD_TITLE_LENGTH } from "./thread-title";

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

export const threadEventTurnStatusSchema = z.enum(["completed", "failed", "interrupted"]);
export type ThreadEventTurnStatus = z.infer<typeof threadEventTurnStatusSchema>;

// what kind of refusal failed a turn, as the adapter classed it: `auth` and `usage-limit` are
// refusals the next queued message would meet too, so a settle holds the queue on them.
export const providerFailureSchema = z.enum([
  "auth",
  "usage-limit",
  "overloaded",
  "context",
  "other",
]);
export type ProviderFailure = z.infer<typeof providerFailureSchema>;

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

// anything looser than turn scope says why beside it.
export const threadEventSchema = z.discriminatedUnion("type", [
  z.object({
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("turn/started"),
  }),
  z.object({
    error: z.object({ message: z.string() }).optional(),
    scope: turnScopeSchema,
    status: threadEventTurnStatusSchema,
    threadId: z.string(),
    type: z.literal("turn/completed"),
  }),
  z.object({
    item: threadEventItemSchema,
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/started"),
  }),
  z.object({
    item: threadEventItemSchema,
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/completed"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/agentMessage/delta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    // true replaces the accumulated output instead of appending.
    reset: z.boolean().optional(),
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/commandExecution/outputDelta"),
  }),
  // codex streams visible thinking as summary deltas; content deltas carry raw chain-of-thought
  // only for models that expose it. both fold into the one reasoning row.
  z.object({
    delta: z.string(),
    itemId: z.string(),
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/reasoning/summaryTextDelta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/reasoning/textDelta"),
  }),
  z.object({
    delta: z.string(),
    itemId: z.string(),
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/plan/delta"),
  }),
  z.object({
    scope: turnScopeSchema,
    threadId: z.string(),
    tokenUsage: threadEventTokenUsageSchema,
    type: z.literal("thread/tokenUsage/updated"),
  }),
  z.object({
    detail: z.string().optional(),
    // optional, so a log written before it parses; a class a later build adds reads as none
    // here rather than costing the whole event its parse on a stale install.
    failure: z.preprocess(
      (value) =>
        value === undefined || providerFailureSchema.safeParse(value).success ? value : null,
      providerFailureSchema.nullable().optional(),
    ),
    message: z.string(),
    // thread scope for a provider setup or session failure, turn scope for one inside a turn.
    scope: threadEventScopeSchema,
    threadId: z.string(),
    type: z.literal("provider/error"),
    willRetry: z.boolean().optional(),
  }),
  // `text` is exactly what the user typed.
  z.object({
    // the phone's dispatch this request carries out, so the phone swaps its pending message for
    // this row; a build that predates it strips it, since this object is not strict.
    dispatchId: z.string().min(1).optional(),
    // recorded before the provider accepts a turn, so no turn id exists yet.
    scope: threadScopeSchema,
    text: z.string(),
    threadId: z.string(),
    type: z.literal("client/turn/requested"),
  }),
  // local: a thread's own facts ride its log, so another device learns them the way it learns the
  // conversation. bb's thread/name/updated is a provider naming its session, not the app's title.
  // a field present is the thread's value as of this row; an absent one is left as it is.
  z.object({
    providerId: z.string().min(1).optional(),
    // a fact about the thread itself, stated outside any turn.
    scope: threadScopeSchema,
    threadId: z.string(),
    title: z.string().min(1).max(MAX_THREAD_TITLE_LENGTH).optional(),
    type: z.literal("thread/meta"),
  }),
  z.object({
    // a fact about the thread itself, stated outside any turn.
    scope: threadScopeSchema,
    threadId: z.string(),
    type: z.literal("thread/archived"),
  }),
]);
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
    case "thread/archived":
    case "thread/meta":
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
    case "thread/archived":
    case "thread/meta":
    case "thread/tokenUsage/updated":
    case "turn/completed":
    case "turn/started": {
      return false;
    }
    // no default
  }
};
