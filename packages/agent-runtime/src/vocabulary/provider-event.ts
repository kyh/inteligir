// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// ProviderEvent here and ThreadEvent in @repo/domain are two unions on purpose: this one is wider
// and types only, since the runtime constructs and never parses; the server narrows it onto the
// persisted one. never invent a divergent shape for an event bb already names; re-vendor it.

import type {
  ThreadEventFileChange,
  ThreadEventItemApprovalStatus,
  ThreadEventItemStatus,
  ThreadEventTokenUsage,
  ThreadEventTurnStatus,
} from "@repo/domain/provider-event";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import { z } from "zod";
import { jsonValueSchema, type JsonObject } from "./json-value";

export const providerErrorCategoryValues = [
  "active-turn-not-steerable",
  "bad-request",
  "connection-failed",
  "context-window-exceeded",
  "internal",
  "overloaded",
  "policy",
  "rate-limit",
  "sandbox",
  "stream-disconnected",
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

export interface ProviderEventPlanStep {
  step: string;
  status?: "pending" | "active" | "completed" | "failed";
}

export interface ProviderEventContextWindowUsage {
  usedTokens: number | null;
  modelContextWindow: number | null;
  estimated: boolean;
}

export type ProviderEventUserContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export interface ProviderEventWebSearchItem {
  type: "webSearch";
  id: string;
  queries: string[];
  resultText: string | null;
}

export interface ProviderEventWebFetchItem {
  type: "webFetch";
  id: string;
  url: string;
  prompt: string | null;
  pattern: string | null;
  resultText: string | null;
}

export interface ProviderEventCommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  status: ThreadEventItemStatus;
  approvalStatus: ThreadEventItemApprovalStatus;
  aggregatedOutput?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface ProviderEventFileChangeItem {
  type: "fileChange";
  id: string;
  changes: ThreadEventFileChange[];
  status: ThreadEventItemStatus;
  approvalStatus: ThreadEventItemApprovalStatus;
}

export interface ProviderEventToolCallItem {
  type: "toolCall";
  id: string;
  server?: string;
  tool: string;
  arguments?: JsonObject;
  status: ThreadEventItemStatus;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export type ProviderEventItem =
  | { type: "userMessage"; id: string; content: ProviderEventUserContent[] }
  | { type: "agentMessage"; id: string; text: string }
  | ProviderEventCommandExecutionItem
  | ProviderEventFileChangeItem
  | ProviderEventWebSearchItem
  | ProviderEventWebFetchItem
  | { type: "imageView"; id: string; path: string }
  | ProviderEventToolCallItem
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "plan"; id: string; text: string }
  | { type: "contextCompaction"; id: string };

export type ProviderEventItemType = ProviderEventItem["type"];

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

export interface ProviderTurnCompletedEvent extends ScopedEventData {
  type: "turn/completed";
  threadId: string;
  // nullable here alone: reconciliation synthesizes an interrupted completion before the provider
  // id resolved.
  providerThreadId: string | null;
  status: ThreadEventTurnStatus;
  error?: { message: string };
}

export interface ProviderToolCallProgressEvent extends ProviderThreadEventData {
  type: "item/toolCall/progress";
  itemId: string;
  message?: string;
}

export interface ProviderTurnPlanUpdatedEvent extends ProviderThreadEventData {
  type: "turn/plan/updated";
  plan: ProviderEventPlanStep[];
  explanation?: string;
}

export interface ProviderErrorEvent extends ProviderThreadEventData {
  type: "provider/error";
  message: string;
  detail?: string;
  willRetry?: boolean;
  errorInfo?: ProviderErrorInfo;
}

export interface ProviderWarningEvent extends ProviderThreadEventData {
  type: "provider/warning";
  category: "deprecation" | "config";
  summary?: string;
  details?: string;
}

export type ProviderEvent =
  | ({ type: "thread/started"; threadId: string } & ScopedEventData)
  | ({ type: "thread/identity" } & ProviderThreadEventData)
  | ({ type: "thread/name/updated"; threadName: string } & ProviderThreadEventData)
  | ({ type: "thread/compacted" } & ProviderThreadEventData)
  | ({ type: "turn/started" } & ProviderThreadEventData)
  | ProviderTurnCompletedEvent
  | ({ type: "item/started"; item: ProviderEventItem } & ProviderThreadEventData)
  | ({ type: "item/completed"; item: ProviderEventItem } & ProviderThreadEventData)
  | ({ type: "item/agentMessage/delta" } & ItemDeltaEventData)
  | ({
      type: "item/commandExecution/outputDelta";
      reset?: boolean;
    } & ItemDeltaEventData)
  | ({ type: "item/fileChange/outputDelta" } & ItemDeltaEventData)
  | ({ type: "item/reasoning/summaryTextDelta" } & ItemDeltaEventData)
  | ({ type: "item/reasoning/textDelta" } & ItemDeltaEventData)
  | ({ type: "item/plan/delta" } & ItemDeltaEventData)
  | ProviderToolCallProgressEvent
  | ({
      type: "thread/tokenUsage/updated";
      tokenUsage: ThreadEventTokenUsage;
    } & ProviderThreadEventData)
  | ({
      type: "thread/contextWindowUsage/updated";
      contextWindowUsage: ProviderEventContextWindowUsage;
    } & ProviderThreadEventData)
  | ProviderTurnPlanUpdatedEvent
  | ({ type: "turn/diff/updated"; diff?: string } & ProviderThreadEventData)
  | ProviderErrorEvent
  | ProviderWarningEvent
  | ({
      type: "provider/unhandled";
      providerId: string;
      rawType: string;
      rawEvent: ProviderRawEvent;
    } & ProviderThreadEventData);

export type ProviderEventType = ProviderEvent["type"];
