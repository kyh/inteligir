// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// The runtime's provider-event grammar: what a provider adapter may emit.
// This is bb's ProviderEvent side, as TYPES — the runtime constructs these,
// it never parses them (parsing happens where events cross a process
// boundary, which for this deployment is the manager in apps/app narrowing
// onto @repo/domain's persisted grammar). Trimmed families: background
// tasks, goals, rate limits, model fallback, context-window clearing,
// turn/input/accepted correlation and the system/* events — none has a
// kept producer (see PROVENANCE.md). Never invent a divergent shape for an
// event bb already names; re-vendor it instead.

import { z } from "zod";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import { jsonValueSchema } from "./json-value";

export type ThreadEventItemStatus = "pending" | "completed" | "failed" | "interrupted";

export type ThreadEventItemApprovalStatus = "waiting_for_approval" | "denied" | null;

export type ThreadEventTurnStatus = "completed" | "failed" | "interrupted";

export const providerErrorCategoryValues = [
  "active-turn-not-steerable",
  "bad-request",
  "connection-failed",
  "context-window-exceeded",
  "billing",
  "budget-exceeded",
  "internal",
  "max-output-tokens",
  "max-turns",
  "overloaded",
  "policy",
  "rate-limit",
  "sandbox",
  "stream-disconnected",
  "structured-output-retries",
  "thread-rollback-failed",
  "too-many-failed-attempts",
  "unauthorized",
  "unknown",
] as const;
export type ProviderErrorCategory = (typeof providerErrorCategoryValues)[number];

export interface ProviderErrorInfo {
  category: ProviderErrorCategory;
  providerCode: string | null;
  httpStatusCode: number | null;
}

export interface ThreadEventFileChange {
  path: string;
  kind: "add" | "delete" | "update";
  movePath?: string;
  diff?: string;
}

export interface ThreadEventPlanStep {
  step: string;
  status?: "pending" | "active" | "completed" | "failed";
}

export interface ThreadEventTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadEventTokenUsage {
  total: ThreadEventTokenUsageBreakdown;
  last: ThreadEventTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface ThreadEventContextWindowUsage {
  usedTokens: number | null;
  modelContextWindow: number | null;
  estimated: boolean;
}

export type ThreadEventUserContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "localFile"; path: string };

export interface ThreadEventWebSearchItem {
  type: "webSearch";
  id: string;
  queries: string[];
  resultText: string | null;
}

export interface ThreadEventWebFetchItem {
  type: "webFetch";
  id: string;
  url: string;
  prompt: string | null;
  pattern: string | null;
  resultText: string | null;
}

export type ThreadEventItem =
  | { type: "userMessage"; id: string; content: ThreadEventUserContent[] }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: ThreadEventItemStatus;
      approvalStatus: ThreadEventItemApprovalStatus;
      /** Omitted when the process produced no stdout/stderr. */
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | {
      type: "fileChange";
      id: string;
      changes: ThreadEventFileChange[];
      status: ThreadEventItemStatus;
      approvalStatus: ThreadEventItemApprovalStatus;
    }
  | ThreadEventWebSearchItem
  | ThreadEventWebFetchItem
  | { type: "imageView"; id: string; path: string }
  | {
      type: "toolCall";
      id: string;
      server?: string;
      tool: string;
      arguments?: Record<string, unknown>;
      status: ThreadEventItemStatus;
      result?: unknown;
      error?: string;
      durationMs?: number;
    }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "plan"; id: string; text: string }
  | { type: "contextCompaction"; id: string };

export type ThreadEventItemType = ThreadEventItem["type"];

export const providerRawEventSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: jsonValueSchema.optional(),
});
export type ProviderRawEvent = z.infer<typeof providerRawEventSchema>;

interface ScopedEventData {
  scope: ThreadEventScope;
}

interface ProviderThreadEventData extends ScopedEventData {
  threadId: string;
  providerThreadId: string;
}

interface ItemDeltaEventData extends ProviderThreadEventData {
  itemId: string;
  delta: string;
}

/**
 * Events originating from a provider process via the agent runtime. Every
 * one carries `threadId` (the host's id, stamped by the runtime) and — for
 * all but `thread/started` — `providerThreadId`, the provider's internal id.
 */
export type ThreadEvent =
  | ({ type: "thread/started"; threadId: string } & ScopedEventData)
  | ({ type: "thread/identity" } & ProviderThreadEventData)
  | ({ type: "thread/name/updated"; threadName: string } & ProviderThreadEventData)
  | ({ type: "thread/compacted" } & ProviderThreadEventData)
  | ({ type: "turn/started" } & ProviderThreadEventData)
  | ({
      type: "turn/completed";
      threadId: string;
      // Runtime reconciliation can synthesize interrupted completions when
      // the provider thread id was never resolved.
      providerThreadId: string | null;
      status: ThreadEventTurnStatus;
      error?: { message: string };
    } & ScopedEventData)
  | ({ type: "item/started"; item: ThreadEventItem } & ProviderThreadEventData)
  | ({ type: "item/completed"; item: ThreadEventItem } & ProviderThreadEventData)
  | ({ type: "item/agentMessage/delta" } & ItemDeltaEventData)
  | ({
      type: "item/commandExecution/outputDelta";
      /** True: the delta REPLACES accumulated output; absent means append. */
      reset?: boolean;
    } & ItemDeltaEventData)
  | ({ type: "item/fileChange/outputDelta" } & ItemDeltaEventData)
  | ({ type: "item/reasoning/summaryTextDelta" } & ItemDeltaEventData)
  | ({ type: "item/reasoning/textDelta" } & ItemDeltaEventData)
  | ({ type: "item/plan/delta" } & ItemDeltaEventData)
  | ({ type: "item/toolCall/progress"; itemId: string; message?: string } & ProviderThreadEventData)
  | ({
      type: "thread/tokenUsage/updated";
      tokenUsage: ThreadEventTokenUsage;
    } & ProviderThreadEventData)
  | ({
      type: "thread/contextWindowUsage/updated";
      contextWindowUsage: ThreadEventContextWindowUsage;
    } & ProviderThreadEventData)
  | ({
      type: "turn/plan/updated";
      plan: ThreadEventPlanStep[];
      explanation?: string;
    } & ProviderThreadEventData)
  | ({ type: "turn/diff/updated"; diff?: string } & ProviderThreadEventData)
  | ({
      type: "provider/error";
      message: string;
      detail?: string;
      willRetry?: boolean;
      errorInfo?: ProviderErrorInfo;
    } & ProviderThreadEventData)
  | ({
      type: "provider/warning";
      category: "deprecation" | "config" | "general";
      summary?: string;
      details?: string;
    } & ProviderThreadEventData)
  | ({
      type: "provider/unhandled";
      providerId: string;
      rawType: string;
      rawEvent: ProviderRawEvent;
    } & ProviderThreadEventData);

export type ThreadEventType = ThreadEvent["type"];
