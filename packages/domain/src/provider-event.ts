// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// the persisted grammar: what the ACP mapper emits as the host narrows it, plus the host's own
// facts. a kind or field nothing produces has no place here, since every consumer would branch on
// it; re-vendor an event from bb rather than inventing a shape bb already names.

import { z } from "zod";
import { threadEventScopeSchema, threadScopeSchema, turnScopeSchema } from "./thread-event-scope";
import { MAX_THREAD_TITLE_LENGTH } from "./thread-title";
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

export const threadEventItemSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal("agentMessage"),
  }),
  z.object({
    id: z.string(),
    text: z.string(),
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
]);
export type ThreadEventItem = z.infer<typeof threadEventItemSchema>;
export type ThreadEventItemType = ThreadEventItem["type"];

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
    scope: turnScopeSchema,
    threadId: z.string(),
    type: z.literal("item/reasoning/textDelta"),
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
  }),
  // contextPaths and viewContext are local additions to bb's shape, beside `text` rather than
  // folded into it, so `text` stays exactly what the user typed; no migration, since events.data
  // is free-form json re-parsed through this schema.
  z.object({
    // the notes the user attached by @-mention, held to the vault path grammar at the wire.
    contextPaths: z.array(z.string().min(1)).optional(),
    // the phone's dispatch this request carries out, so the phone swaps its pending message for
    // this row; a build that predates it strips it, since this object is not strict.
    dispatchId: z.string().min(1).optional(),
    // recorded before the provider accepts a turn, so no turn id exists yet.
    scope: threadScopeSchema,
    text: z.string(),
    threadId: z.string(),
    type: z.literal("client/turn/requested"),
    viewContext: viewContextSchema.optional(),
  }),
  // local: a thread's own facts ride its log, so another device learns them the way it learns the
  // conversation. bb's thread/name/updated is a provider naming its session, not the app's title.
  // a field present is the thread's value as of this row; an absent one is left as it is.
  z.object({
    originDocPath: z.string().min(1).optional(),
    // the origin note's frontmatter id, stated only beside its path: a move anywhere keeps it.
    originNoteId: z.string().min(1).optional(),
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
    case "item/reasoning/textDelta": {
      return { itemId: event.itemId, itemKind: null };
    }
    case "client/turn/requested":
    case "provider/error":
    case "thread/archived":
    case "thread/meta":
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
    case "item/reasoning/textDelta": {
      return true;
    }
    case "client/turn/requested":
    case "item/completed":
    case "item/started":
    case "provider/error":
    case "thread/archived":
    case "thread/meta":
    case "turn/completed":
    case "turn/started": {
      return false;
    }
    // no default
  }
};

const joinsRun = (run: ThreadEventDelta, next: ThreadEventDelta): boolean =>
  next.type === run.type &&
  next.itemId === run.itemId &&
  next.threadId === run.threadId &&
  next.scope.turnId === run.scope.turnId;

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
