// A turn's events as the cell keeps them. Every buffered event a session's stream or its listing
// gives is classed by its type: the conversation's own (the person's messages, confirmations and
// interrupts, the agent's messages and tool calls, its idles and end, its usage) is stored as the
// thread's event, keyed by its `sevt_` id, so a reconcile that meets it again stores nothing twice;
// a type this build never heard of is stored raw, since the SDK's unions are open and a newer
// device may read it; the rest (spans, status changes, thinking) is read and let go. What an event
// means for the turn is read from it here as well: an approval it waits on, the final stop reason
// that ends it, a credential Anthropic could not use, and the usage the ledger books as the
// difference from the session's last report (platform.claude.com/docs/en/managed-agents/events-and-streaming).

import type { threadEventRowSchema } from "@repo/contract/cloud/library/library-wire";
import type {
  BetaManagedAgentsSessionEventType,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { BetaManagedAgentsSessionUsageEvent } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import { recordChanges } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { LandingScope } from "../library/cell-landing";
import { THREAD_EVENT_COLUMNS, threadEventRowFrom } from "../library/cell-sync";
import { bookUsage } from "./agent-allowance";
import { sessionRow } from "./turn-rows";
import type { TurnEnd } from "./turn-rows";

// an event as the SDK yields it: its union is open, so a type this build never heard of arrives
// too, and every field read past its type is parsed here
export type StreamEvent = BetaManagedAgentsStreamSessionEvents;

type StreamEventType = StreamEvent["type"];

// what the cell does with each type the SDK names: keep it as the thread's, read it and let it
// go, or fold it into the live preview of the agent's message, which is never kept
const EVENT_ROLES = {
  "agent.custom_tool_use": "skip",
  "agent.mcp_tool_result": "store",
  "agent.mcp_tool_use": "store",
  "agent.message": "store",
  "agent.thinking": "skip",
  "agent.thread_context_compacted": "skip",
  "agent.thread_message_received": "skip",
  "agent.thread_message_sent": "skip",
  "agent.tool_result": "skip",
  "agent.tool_use": "skip",
  event_delta: "preview",
  event_start: "preview",
  "session.deleted": "skip",
  "session.error": "skip",
  "session.status_idle": "store",
  "session.status_rescheduled": "skip",
  "session.status_running": "skip",
  "session.status_terminated": "store",
  "session.thread_created": "skip",
  "session.thread_status_idle": "skip",
  "session.thread_status_rescheduled": "skip",
  "session.thread_status_running": "skip",
  "session.thread_status_terminated": "skip",
  "session.updated": "skip",
  "session.usage": "store",
  "span.model_request_end": "skip",
  "span.model_request_start": "skip",
  "span.outcome_evaluation_end": "skip",
  "span.outcome_evaluation_ongoing": "skip",
  "span.outcome_evaluation_start": "skip",
  "system.message": "skip",
  "user.custom_tool_result": "skip",
  "user.define_outcome": "skip",
  "user.interrupt": "store",
  "user.message": "store",
  "user.tool_confirmation": "store",
  "user.tool_result": "skip",
  "workflow_run.created": "skip",
  "workflow_run.error": "skip",
  "workflow_run.phase_ended": "skip",
  "workflow_run.phase_started": "skip",
  "workflow_run.status_ended": "skip",
  "workflow_run.status_idle": "skip",
  "workflow_run.status_running": "skip",
} as const satisfies Record<StreamEventType, "store" | "skip" | "preview">;

const isKnownType = (type: string): type is StreamEventType => Object.hasOwn(EVENT_ROLES, type);

// what a reconcile lists of a session's events: those the cell keeps, and the errors that say its
// credential failed
export const LISTED_TYPES: readonly BetaManagedAgentsSessionEventType[] = [
  "user.message",
  "user.interrupt",
  "user.tool_confirmation",
  "agent.message",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
  "session.status_idle",
  "session.status_terminated",
  "session.usage",
  "session.error",
];

// what the cell keeps of a type: a known one by its role, an unknown one raw
export const roleOf = (type: string): "store" | "skip" | "preview" =>
  isKnownType(type) ? EVENT_ROLES[type] : "store";

// a buffered event's own fields, read at this boundary whatever its type; an interrupt may carry
// an empty id, which names nothing to keep it by
const eventHeadSchema = z.looseObject({
  id: z.string().min(1).max(128),
  processed_at: z.string().nullish(),
  type: z.string().min(1).max(128),
});

const stopReasonSchema = z.looseObject({
  event_ids: z.array(z.string()).optional(),
  type: z.string(),
});

const errorSchema = z.looseObject({ error: z.looseObject({ type: z.string() }) });
const usageSchema = z.looseObject({
  usage: z.looseObject({
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    list_cost: z.object({ amount: z.string().regex(/^\d+$/u) }).nullish(),
    output_tokens: z.number().int().nonnegative().optional(),
  }),
});

// the final stop reasons, which end a turn once the session is confirmed at rest
const FINAL_STOPS = new Set<string>(["end_turn", "retries_exhausted", "budget_reached", "refusal"]);

const finalStopOf = (type: string): TurnEnd =>
  type === "retries_exhausted" || type === "budget_reached" || type === "refusal"
    ? type
    : "end_turn";

// what an event means for the turn
export type TurnSignal =
  | { readonly kind: "none" }
  // the session idles on the person's answer to these calls
  | { readonly kind: "approval"; readonly eventIds: readonly string[] }
  // the person's answer to one of those calls reached the session
  | { readonly kind: "confirmed"; readonly toolUseId: string }
  | { readonly kind: "end"; readonly reason: TurnEnd }
  // Anthropic could not use the credential its vault holds for the connector
  | { readonly kind: "repair" };

const NONE: TurnSignal = { kind: "none" };

export const signalOf = (event: StreamEvent): TurnSignal => {
  switch (event.type) {
    case "session.status_idle": {
      const stop = stopReasonSchema.parse(event.stop_reason);
      if (stop.type === "requires_action") {
        return { eventIds: stop.event_ids ?? [], kind: "approval" };
      }
      if (!FINAL_STOPS.has(stop.type)) {
        // a stop reason this build does not know reads as the turn's end: only `requires_action`
        // keeps a session waiting on the person, and the session's own status confirms it
        console.warn({ event: "agent-stop-reason-unknown", stopReason: stop.type });
      }
      return { kind: "end", reason: finalStopOf(stop.type) };
    }
    case "session.status_terminated":
    case "session.deleted": {
      return { kind: "end", reason: "terminated" };
    }
    case "user.tool_confirmation": {
      return { kind: "confirmed", toolUseId: event.tool_use_id };
    }
    case "session.error": {
      const failure = errorSchema.safeParse(event);
      return failure.success && failure.data.error.type === "mcp_authentication_failed_error"
        ? { kind: "repair" }
        : NONE;
    }
    default: {
      return NONE;
    }
  }
};

export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// a kept event's row past this would near a Durable Object's 2 MB a value, so it keeps its head
const EVENT_MAX_CHARS = 1024 * 1024;

const keptJson = (event: StreamEvent, head: z.infer<typeof eventHeadSchema>): string => {
  const json = JSON.stringify(event);
  return json.length <= EVENT_MAX_CHARS
    ? json
    : JSON.stringify({
        id: head.id,
        omitted: "too long to keep",
        processed_at: head.processed_at ?? null,
        type: head.type,
      });
};

// the session's usage report booked as its difference from the last, and kept as the last
const bookReport = (
  scope: LandingScope,
  sessionId: string,
  event: BetaManagedAgentsSessionUsageEvent,
): void => {
  const held = sessionRow(scope.storage, sessionId);
  const report = usageSchema.safeParse(event);
  if (!report.success || held === null) {
    return;
  }
  const { usage } = report.data;
  const now = {
    cached: usage.cache_read_input_tokens ?? held.cached_tokens,
    costCents: Number(usage.list_cost?.amount ?? held.cost_cents),
    input: usage.input_tokens ?? held.input_tokens,
    output: usage.output_tokens ?? held.output_tokens,
  };
  bookUsage(scope.storage, scope.now, {
    cached: Math.max(0, now.cached - held.cached_tokens),
    costCents: Math.max(0, now.costCents - held.cost_cents),
    input: Math.max(0, now.input - held.input_tokens),
    output: Math.max(0, now.output - held.output_tokens),
  });
  scope.storage.run(
    `UPDATE agent_sessions SET cost_cents = max(cost_cents, ?), input_tokens = max(input_tokens, ?),
       cached_tokens = max(cached_tokens, ?), output_tokens = max(output_tokens, ?)
     WHERE session_id = ?`,
    [now.costCents, now.input, now.cached, now.output, sessionId],
  );
};

const idxSchema = z.object({ idx: z.number() });

// the event kept as the thread's, once: its row, or null for one kept before (or one with no id)
export const keepEvent = (
  scope: LandingScope,
  where: { readonly threadId: string; readonly sessionId: string },
  event: StreamEvent,
): ThreadEventRow | null => {
  const head = eventHeadSchema.safeParse(event);
  if (!head.success || roleOf(head.data.type) !== "store") {
    return null;
  }
  const { storage } = scope;
  if (storage.all("SELECT 1 FROM thread_events WHERE event_id = ?", [head.data.id]).length > 0) {
    return null;
  }
  const [last] = storage.all(
    "SELECT coalesce(max(idx), -1) AS idx FROM thread_events WHERE thread_id = ?",
    [where.threadId],
  );
  const processedAt = head.data.processed_at ?? null;
  const at = processedAt === null ? Number.NaN : Date.parse(processedAt);
  const seq = scope.seq();
  storage.run(
    `INSERT INTO thread_events (event_id, thread_id, idx, type, json, at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      head.data.id,
      where.threadId,
      idxSchema.parse(last).idx + 1,
      head.data.type,
      keptJson(event, head.data),
      Number.isFinite(at) ? at : scope.now,
      seq,
    ],
  );
  runPlan(storage, recordChanges([{ gone: false, id: head.data.id, kind: "thread_event", seq }]));
  if (processedAt !== null) {
    storage.run(
      "UPDATE agent_sessions SET cursor = ? WHERE session_id = ? AND (cursor IS NULL OR cursor < ?)",
      [processedAt, where.sessionId, processedAt],
    );
  }
  if (event.type === "session.usage") {
    bookReport(scope, where.sessionId, event);
  }
  const [row] = storage.all(
    `SELECT ${THREAD_EVENT_COLUMNS} FROM thread_events WHERE event_id = ?`,
    [head.data.id],
  );
  return row === undefined ? null : threadEventRowFrom(row);
};

const textBlocksSchema = z.object({
  content: z.array(z.looseObject({ text: z.string().optional(), type: z.string() })),
});

// the text of a kept user or agent message, its view context and earlier conversation aside: the
// last block of a person's message is what they wrote
export const messageTextOf = (event: ThreadEventRow["event"]): string => {
  const parsed = textBlocksSchema.safeParse(event);
  if (!parsed.success) {
    return "";
  }
  const texts = parsed.data.content.flatMap((block) =>
    block.type === "text" && block.text !== undefined ? [block.text] : [],
  );
  return texts.at(-1) ?? "";
};
