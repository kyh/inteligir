// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// trimmed to what has a producer here; re-vendor an event from bb rather than inventing a shape
// bb already names.

import { z } from "zod";
import { threadEventScopeSchema, validateThreadEventScope } from "./thread-event-scope";
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
  path: z.string(),
  kind: threadEventFileChangeKindSchema,
  movePath: z.string().optional(),
  diff: z.string().optional(),
});
export type ThreadEventFileChange = z.infer<typeof threadEventFileChangeSchema>;

export const threadEventTokenUsageBreakdownSchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});
export type ThreadEventTokenUsageBreakdown = z.infer<typeof threadEventTokenUsageBreakdownSchema>;

export const threadEventTokenUsageSchema = z.object({
  total: threadEventTokenUsageBreakdownSchema,
  last: threadEventTokenUsageBreakdownSchema,
  modelContextWindow: z.number().nullable(),
});
export type ThreadEventTokenUsage = z.infer<typeof threadEventTokenUsageSchema>;

export const threadEventItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("userMessage"),
    id: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("agentMessage"),
    id: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    summary: z.array(z.string()),
    content: z.array(z.string()),
  }),
  z.object({
    type: z.literal("toolCall"),
    id: z.string(),
    server: z.string().optional(),
    tool: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    status: threadEventItemStatusSchema,
    result: z.unknown().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("commandExecution"),
    id: z.string(),
    command: z.string(),
    cwd: z.string(),
    status: threadEventItemStatusSchema,
    approvalStatus: threadEventItemApprovalStatusSchema,
    // omitted, never an empty string, when the process produced no output.
    aggregatedOutput: z.string().optional(),
    exitCode: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("fileChange"),
    id: z.string(),
    changes: z.array(threadEventFileChangeSchema),
    status: threadEventItemStatusSchema,
    approvalStatus: threadEventItemApprovalStatusSchema,
  }),
  z.object({
    type: z.literal("plan"),
    id: z.string(),
    text: z.string(),
  }),
]);
export type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
export type ThreadEventItemType = ThreadEventItem["type"];

const unscopedThreadEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn/started"),
    threadId: z.string(),
  }),
  z.object({
    type: z.literal("turn/completed"),
    threadId: z.string(),
    status: threadEventTurnStatusSchema,
    error: z.object({ message: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("item/started"),
    threadId: z.string(),
    item: threadEventItemSchema,
  }),
  z.object({
    type: z.literal("item/completed"),
    threadId: z.string(),
    item: threadEventItemSchema,
  }),
  z.object({
    type: z.literal("item/agentMessage/delta"),
    threadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("item/commandExecution/outputDelta"),
    threadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
    // true replaces the accumulated output instead of appending.
    reset: z.boolean().optional(),
  }),
  // codex streams visible thinking as summary deltas; content deltas carry raw chain-of-thought
  // only for models that expose it. both fold into the one reasoning row.
  z.object({
    type: z.literal("item/reasoning/summaryTextDelta"),
    threadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("item/reasoning/textDelta"),
    threadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("item/plan/delta"),
    threadId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("thread/tokenUsage/updated"),
    threadId: z.string(),
    tokenUsage: threadEventTokenUsageSchema,
  }),
  z.object({
    type: z.literal("provider/error"),
    threadId: z.string(),
    message: z.string(),
    detail: z.string().optional(),
    willRetry: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("client/turn/requested"),
    threadId: z.string(),
    text: z.string(),
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
    const result = validateThreadEventScope({ type: event.type, scope: event.scope });
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
export function getThreadEventItemRef(event: ThreadEvent): ThreadEventItemRef {
  switch (event.type) {
    case "item/started":
    case "item/completed":
      return { itemId: event.item.id, itemKind: event.item.type };
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
      return { itemId: event.itemId, itemKind: null };
    default:
      return { itemId: null, itemKind: null };
  }
}
