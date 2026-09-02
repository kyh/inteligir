// a kind the persisted grammar lacks is dropped with a reason, never re-shaped: re-vendor it into @repo/domain
// when it earns a renderer. shared leaves are one type in @repo/domain, so a narrowing assigns them; a
// field-by-field respelling here means the two drifted.

import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type { ThreadEvent, ThreadEventItem } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";

export type MapProviderEventResult =
  | { kind: "mapped"; event: ThreadEvent }
  | { kind: "dropped"; reason: string };

function dropped(reason: string): MapProviderEventResult {
  return { kind: "dropped", reason };
}

type ProviderItem = Extract<ProviderEvent, { type: "item/started" }>["item"];

function mapItem(item: ProviderItem): ThreadEventItem | null {
  switch (item.type) {
    case "agentMessage":
      return { type: "agentMessage", id: item.id, text: item.text };
    case "reasoning":
      return { type: "reasoning", id: item.id, summary: item.summary, content: item.content };
    case "commandExecution": {
      const mapped: Extract<ThreadEventItem, { type: "commandExecution" }> = {
        type: "commandExecution",
        id: item.id,
        command: item.command,
        cwd: item.cwd,
        status: item.status,
        approvalStatus: item.approvalStatus,
      };
      if (item.aggregatedOutput !== undefined) mapped.aggregatedOutput = item.aggregatedOutput;
      if (item.exitCode !== undefined) mapped.exitCode = item.exitCode;
      if (item.durationMs !== undefined) mapped.durationMs = item.durationMs;
      return mapped;
    }
    case "fileChange":
      return {
        type: "fileChange",
        id: item.id,
        changes: item.changes,
        status: item.status,
        approvalStatus: item.approvalStatus,
      };
    case "toolCall": {
      const mapped: Extract<ThreadEventItem, { type: "toolCall" }> = {
        type: "toolCall",
        id: item.id,
        tool: item.tool,
        status: item.status,
      };
      if (item.server !== undefined) mapped.server = item.server;
      if (item.arguments !== undefined) mapped.arguments = item.arguments;
      if (item.result !== undefined) mapped.result = item.result;
      if (item.error !== undefined) mapped.error = item.error;
      if (item.durationMs !== undefined) mapped.durationMs = item.durationMs;
      return mapped;
    }
    case "plan":
      return { type: "plan", id: item.id, text: item.text };
    // the send path already recorded the user's message; the provider's echo would double it.
    case "userMessage":
    // no renderer in the persisted grammar yet:
    case "webSearch":
    case "webFetch":
    case "imageView":
    case "contextCompaction":
      return null;
  }
}

export function mapProviderEvent(
  event: ProviderEvent,
  turnId: string | null,
): MapProviderEventResult {
  switch (event.type) {
    case "turn/started": {
      if (turnId === null) {
        return dropped("turn/started with no host turn bound");
      }
      return {
        kind: "mapped",
        event: { type: "turn/started", threadId: event.threadId, scope: turnScope(turnId) },
      };
    }
    case "turn/completed": {
      if (turnId === null) {
        return dropped("turn/completed with no host turn bound");
      }
      const completed: Extract<ThreadEvent, { type: "turn/completed" }> = {
        type: "turn/completed",
        threadId: event.threadId,
        scope: turnScope(turnId),
        status: event.status,
      };
      if (event.error !== undefined) completed.error = event.error;
      return { kind: "mapped", event: completed };
    }
    case "item/started":
    case "item/completed": {
      if (turnId === null) {
        return dropped(`${event.type} with no host turn bound`);
      }
      const item = mapItem(event.item);
      if (item === null) {
        return dropped(`item kind ${event.item.type} has no persisted renderer`);
      }
      return {
        kind: "mapped",
        event: { type: event.type, threadId: event.threadId, scope: turnScope(turnId), item },
      };
    }
    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta": {
      if (turnId === null) {
        return dropped(`${event.type} with no host turn bound`);
      }
      return {
        kind: "mapped",
        event: {
          type: event.type,
          threadId: event.threadId,
          scope: turnScope(turnId),
          itemId: event.itemId,
          delta: event.delta,
        },
      };
    }
    case "item/commandExecution/outputDelta": {
      if (turnId === null) {
        return dropped(`${event.type} with no host turn bound`);
      }
      const outputDelta: Extract<ThreadEvent, { type: "item/commandExecution/outputDelta" }> = {
        type: event.type,
        threadId: event.threadId,
        scope: turnScope(turnId),
        itemId: event.itemId,
        delta: event.delta,
      };
      if (event.reset !== undefined) outputDelta.reset = event.reset;
      return { kind: "mapped", event: outputDelta };
    }
    case "thread/tokenUsage/updated": {
      if (turnId === null) {
        return dropped("thread/tokenUsage/updated with no host turn bound");
      }
      return {
        kind: "mapped",
        event: {
          type: "thread/tokenUsage/updated",
          threadId: event.threadId,
          scope: turnScope(turnId),
          tokenUsage: event.tokenUsage,
        },
      };
    }
    case "provider/error": {
      const failure: Extract<ThreadEvent, { type: "provider/error" }> = {
        type: "provider/error",
        threadId: event.threadId,
        scope: turnId === null ? threadScope() : turnScope(turnId),
        message: event.message,
      };
      if (event.detail !== undefined) failure.detail = event.detail;
      if (event.willRetry !== undefined) failure.willRetry = event.willRetry;
      return { kind: "mapped", event: failure };
    }
    case "thread/started":
    case "thread/identity":
    case "thread/name/updated":
    case "thread/compacted":
    case "item/fileChange/outputDelta":
    case "item/toolCall/progress":
    case "thread/contextWindowUsage/updated":
    case "turn/plan/updated":
    case "turn/diff/updated":
    case "provider/warning":
    case "provider/unhandled":
      return dropped(`${event.type} has no persisted mapping`);
  }
}
