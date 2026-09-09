// a kind the persisted grammar lacks is dropped with a reason, never re-shaped: re-vendor it into @repo/domain
// when it earns a renderer. shared leaves are one type in @repo/domain, so a narrowing assigns them; a
// field-by-field respelling here means the two drifted.

import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type { ThreadEvent, ThreadEventItem } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";

export type MapProviderEventResult =
  | { kind: "mapped"; event: ThreadEvent }
  | { kind: "dropped"; reason: string };

const dropped = (reason: string): MapProviderEventResult => ({ kind: "dropped", reason });

type ProviderItem = Extract<ProviderEvent, { type: "item/started" }>["item"];

const mapItem = (item: ProviderItem): ThreadEventItem | null => {
  switch (item.type) {
    case "agentMessage": {
      return { id: item.id, text: item.text, type: "agentMessage" };
    }
    case "reasoning": {
      return { content: item.content, id: item.id, summary: item.summary, type: "reasoning" };
    }
    case "commandExecution": {
      const mapped: Extract<ThreadEventItem, { type: "commandExecution" }> = {
        approvalStatus: item.approvalStatus,
        command: item.command,
        cwd: item.cwd,
        id: item.id,
        status: item.status,
        type: "commandExecution",
      };
      if (item.aggregatedOutput !== undefined) {
        mapped.aggregatedOutput = item.aggregatedOutput;
      }
      if (item.exitCode !== undefined) {
        mapped.exitCode = item.exitCode;
      }
      if (item.durationMs !== undefined) {
        mapped.durationMs = item.durationMs;
      }
      return mapped;
    }
    case "fileChange": {
      return {
        approvalStatus: item.approvalStatus,
        changes: item.changes,
        id: item.id,
        status: item.status,
        type: "fileChange",
      };
    }
    case "toolCall": {
      const mapped: Extract<ThreadEventItem, { type: "toolCall" }> = {
        id: item.id,
        status: item.status,
        tool: item.tool,
        type: "toolCall",
      };
      if (item.server !== undefined) {
        mapped.server = item.server;
      }
      if (item.arguments !== undefined) {
        mapped.arguments = item.arguments;
      }
      if (item.result !== undefined) {
        mapped.result = item.result;
      }
      if (item.error !== undefined) {
        mapped.error = item.error;
      }
      if (item.durationMs !== undefined) {
        mapped.durationMs = item.durationMs;
      }
      return mapped;
    }
    case "plan": {
      return { id: item.id, text: item.text, type: "plan" };
    }
    // userMessage: the send path already recorded it; the provider's echo would double it.
    // the rest have no renderer in the persisted grammar yet.
    case "userMessage":
    case "webSearch":
    case "webFetch":
    case "imageView":
    case "contextCompaction": {
      return null;
    }
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
};

const UNMAPPED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/name/updated",
  "thread/compacted",
  "item/fileChange/outputDelta",
  "item/toolCall/progress",
  "thread/contextWindowUsage/updated",
  "turn/plan/updated",
  "turn/diff/updated",
  "provider/warning",
  "provider/unhandled",
] as const satisfies readonly ProviderEvent["type"][];

type UnmappedProviderEvent = Extract<
  ProviderEvent,
  { type: (typeof UNMAPPED_EVENT_TYPES)[number] }
>;

const UNMAPPED: ReadonlySet<ProviderEvent["type"]> = new Set(UNMAPPED_EVENT_TYPES);

const isUnmapped = (event: ProviderEvent): event is UnmappedProviderEvent =>
  UNMAPPED.has(event.type);

type TurnProviderEvent = Exclude<
  ProviderEvent,
  UnmappedProviderEvent | Extract<ProviderEvent, { type: "provider/error" }>
>;

const mapProviderError = (
  event: Extract<ProviderEvent, { type: "provider/error" }>,
  turnId: string | null,
): MapProviderEventResult => {
  const failure: Extract<ThreadEvent, { type: "provider/error" }> = {
    message: event.message,
    scope: turnId === null ? threadScope() : turnScope(turnId),
    threadId: event.threadId,
    type: "provider/error",
  };
  if (event.detail !== undefined) {
    failure.detail = event.detail;
  }
  if (event.willRetry !== undefined) {
    failure.willRetry = event.willRetry;
  }
  return { event: failure, kind: "mapped" };
};

const mapTurnEvent = (event: TurnProviderEvent, turnId: string): MapProviderEventResult => {
  switch (event.type) {
    case "turn/started": {
      return {
        event: { scope: turnScope(turnId), threadId: event.threadId, type: "turn/started" },
        kind: "mapped",
      };
    }
    case "turn/completed": {
      const completed: Extract<ThreadEvent, { type: "turn/completed" }> = {
        scope: turnScope(turnId),
        status: event.status,
        threadId: event.threadId,
        type: "turn/completed",
      };
      if (event.error !== undefined) {
        completed.error = event.error;
      }
      return { event: completed, kind: "mapped" };
    }
    case "item/started":
    case "item/completed": {
      const item = mapItem(event.item);
      if (item === null) {
        return dropped(`item kind ${event.item.type} has no persisted renderer`);
      }
      return {
        event: { item, scope: turnScope(turnId), threadId: event.threadId, type: event.type },
        kind: "mapped",
      };
    }
    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta": {
      return {
        event: {
          delta: event.delta,
          itemId: event.itemId,
          scope: turnScope(turnId),
          threadId: event.threadId,
          type: event.type,
        },
        kind: "mapped",
      };
    }
    case "item/commandExecution/outputDelta": {
      const outputDelta: Extract<ThreadEvent, { type: "item/commandExecution/outputDelta" }> = {
        delta: event.delta,
        itemId: event.itemId,
        scope: turnScope(turnId),
        threadId: event.threadId,
        type: event.type,
      };
      if (event.reset !== undefined) {
        outputDelta.reset = event.reset;
      }
      return { event: outputDelta, kind: "mapped" };
    }
    case "thread/tokenUsage/updated": {
      return {
        event: {
          scope: turnScope(turnId),
          threadId: event.threadId,
          tokenUsage: event.tokenUsage,
          type: "thread/tokenUsage/updated",
        },
        kind: "mapped",
      };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};

export const mapProviderEvent = (
  event: ProviderEvent,
  turnId: string | null,
): MapProviderEventResult => {
  if (isUnmapped(event)) {
    return dropped(`${event.type} has no persisted mapping`);
  }
  if (event.type === "provider/error") {
    return mapProviderError(event, turnId);
  }
  if (turnId === null) {
    return dropped(`${event.type} with no host turn bound`);
  }
  return mapTurnEvent(event, turnId);
};
