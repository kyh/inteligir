// Narrows the runtime's provider grammar (@repo/agent-runtime — bb's full
// provider event union) onto @repo/domain's persisted grammar, which IS that
// grammar trimmed to the kinds v1 renders. The rule from the domain header
// applies here in reverse: an event kind the persisted grammar does not
// carry is DROPPED with a stated reason, never re-shaped — re-vendor the
// kind into @repo/domain when it earns a renderer. Turn identity is
// rewritten from the provider's turn id to the host's: the manager owns the
// binding, this module only stamps the id it is handed.

import type { ThreadEvent as RuntimeThreadEvent } from "@repo/agent-runtime/domain/provider-event";
import type { ThreadEvent, ThreadEventItem } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";

export type MapProviderEventResult =
  | { kind: "mapped"; event: ThreadEvent }
  | { kind: "dropped"; reason: string };

function dropped(reason: string): MapProviderEventResult {
  return { kind: "dropped", reason };
}

type ProviderItem = Extract<RuntimeThreadEvent, { type: "item/started" }>["item"];

function mapItem(item: ProviderItem): ThreadEventItem | null {
  switch (item.type) {
    case "agentMessage":
      return { type: "agentMessage", id: item.id, text: item.text };
    case "reasoning":
      return { type: "reasoning", id: item.id, summary: item.summary, content: item.content };
    case "commandExecution":
      return {
        type: "commandExecution",
        id: item.id,
        command: item.command,
        cwd: item.cwd,
        status: item.status,
        approvalStatus: item.approvalStatus,
        ...(item.aggregatedOutput !== undefined ? { aggregatedOutput: item.aggregatedOutput } : {}),
        ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      };
    case "fileChange":
      return {
        type: "fileChange",
        id: item.id,
        changes: item.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          ...(change.movePath !== undefined ? { movePath: change.movePath } : {}),
          ...(change.diff !== undefined ? { diff: change.diff } : {}),
        })),
        status: item.status,
        approvalStatus: item.approvalStatus,
      };
    case "toolCall":
      return {
        type: "toolCall",
        id: item.id,
        ...(item.server !== undefined ? { server: item.server } : {}),
        tool: item.tool,
        ...(item.arguments !== undefined ? { arguments: item.arguments } : {}),
        status: item.status,
        ...(item.result !== undefined ? { result: item.result } : {}),
        ...(item.error !== undefined ? { error: item.error } : {}),
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      };
    case "plan":
      return { type: "plan", id: item.id, text: item.text };
    // The send path already recorded the user's message as
    // client/turn/requested; the provider's echo would double it.
    case "userMessage":
    // No renderer in the persisted grammar yet:
    case "webSearch":
    case "webFetch":
    case "imageView":
    case "contextCompaction":
      return null;
  }
}

/**
 * `turnId` is the HOST's id for the turn this event belongs to, or null when
 * the manager holds no binding (then only thread-scoped kinds survive).
 */
export function mapProviderEvent(
  event: RuntimeThreadEvent,
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
      return {
        kind: "mapped",
        event: {
          type: "turn/completed",
          threadId: event.threadId,
          scope: turnScope(turnId),
          status: event.status,
          ...(event.error !== undefined ? { error: event.error } : {}),
        },
      };
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
      return {
        kind: "mapped",
        event: {
          type: event.type,
          threadId: event.threadId,
          scope: turnScope(turnId),
          itemId: event.itemId,
          delta: event.delta,
          ...(event.reset !== undefined ? { reset: event.reset } : {}),
        },
      };
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
    case "provider/error":
      return {
        kind: "mapped",
        event: {
          type: "provider/error",
          threadId: event.threadId,
          scope: turnId === null ? threadScope() : turnScope(turnId),
          message: event.message,
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
          ...(event.willRetry !== undefined ? { willRetry: event.willRetry } : {}),
        },
      };
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
