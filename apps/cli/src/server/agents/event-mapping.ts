// the persisted grammar takes every kind the mapper emits but an adapter's notice, which the agent
// log alone reads until one earns a renderer. a narrowing assigns shared leaves, never re-shapes.

import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";

export type PersistedProviderEvent = Exclude<ProviderEvent, { type: "provider/notice" }>;

export const mapProviderEvent = (event: PersistedProviderEvent): ThreadEvent => {
  switch (event.type) {
    case "turn/started": {
      return { scope: event.scope, threadId: event.threadId, type: "turn/started" };
    }
    case "turn/completed": {
      const completed: Extract<ThreadEvent, { type: "turn/completed" }> = {
        scope: event.scope,
        status: event.status,
        threadId: event.threadId,
        type: "turn/completed",
      };
      if (event.error !== undefined) {
        completed.error = event.error;
      }
      return completed;
    }
    case "item/started":
    case "item/completed": {
      return { item: event.item, scope: event.scope, threadId: event.threadId, type: event.type };
    }
    case "item/agentMessage/delta":
    case "item/reasoning/textDelta": {
      return {
        delta: event.delta,
        itemId: event.itemId,
        scope: event.scope,
        threadId: event.threadId,
        type: event.type,
      };
    }
    case "provider/error": {
      const error: Extract<ThreadEvent, { type: "provider/error" }> = {
        message: event.message,
        scope: event.scope,
        threadId: event.threadId,
        type: "provider/error",
      };
      if (event.failure !== undefined) {
        error.failure = event.failure;
      }
      return error;
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};
