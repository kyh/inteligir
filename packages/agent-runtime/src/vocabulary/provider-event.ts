// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// ProviderEvent here and ThreadEvent in @repo/domain are two unions on purpose: this one is exactly
// what AcpTurnMapper constructs, types only, and the server narrows it onto the persisted one. a
// kind or field the mapper does not produce has no place here: every consumer would handle it.

import type {
  ThreadEventFileChange,
  ThreadEventItemApprovalStatus,
  ThreadEventItemStatus,
  ThreadEventTurnStatus,
} from "@repo/domain/provider-event";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import type { JsonObject } from "./json-value";

export interface ProviderEventPlanStep {
  step: string;
  status: "pending" | "active" | "completed";
}

interface ProviderEventCommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  status: ThreadEventItemStatus;
  approvalStatus: ThreadEventItemApprovalStatus;
  aggregatedOutput?: string;
}

interface ProviderEventFileChangeItem {
  type: "fileChange";
  id: string;
  changes: ThreadEventFileChange[];
  status: ThreadEventItemStatus;
  approvalStatus: ThreadEventItemApprovalStatus;
}

interface ProviderEventToolCallItem {
  type: "toolCall";
  id: string;
  tool: string;
  arguments?: JsonObject;
  status: ThreadEventItemStatus;
  result?: string;
}

export type ProviderEventItem =
  | { type: "agentMessage"; id: string; text: string }
  | ProviderEventCommandExecutionItem
  | ProviderEventFileChangeItem
  | ProviderEventToolCallItem
  | { type: "reasoning"; id: string; summary: string[]; content: string[] };

interface ProviderThreadEventData {
  scope: ThreadEventScope;
  threadId: string;
  providerThreadId: string;
}

interface ItemDeltaEventData extends ProviderThreadEventData {
  itemId: string;
  delta: string;
}

interface ProviderTurnCompletedEvent extends ProviderThreadEventData {
  type: "turn/completed";
  status: ThreadEventTurnStatus;
  error?: { message: string };
}

interface ProviderToolCallProgressEvent extends ProviderThreadEventData {
  type: "item/toolCall/progress";
  itemId: string;
  message: string;
}

interface ProviderTurnPlanUpdatedEvent extends ProviderThreadEventData {
  type: "turn/plan/updated";
  plan: ProviderEventPlanStep[];
}

interface ProviderErrorEvent extends ProviderThreadEventData {
  type: "provider/error";
  message: string;
}

export type ProviderEvent =
  | ({ type: "turn/started" } & ProviderThreadEventData)
  | ProviderTurnCompletedEvent
  | ({ type: "item/started"; item: ProviderEventItem } & ProviderThreadEventData)
  | ({ type: "item/completed"; item: ProviderEventItem } & ProviderThreadEventData)
  | ({ type: "item/agentMessage/delta" } & ItemDeltaEventData)
  | ({ type: "item/reasoning/textDelta" } & ItemDeltaEventData)
  | ProviderToolCallProgressEvent
  | ProviderTurnPlanUpdatedEvent
  | ProviderErrorEvent;
