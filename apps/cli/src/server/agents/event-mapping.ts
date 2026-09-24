// a kind the persisted grammar lacks is dropped with a reason, never re-shaped: re-vendor it into @repo/domain
// when it earns a renderer. a narrowing assigns shared leaves.

import type { ProviderEvent } from "@repo/agent-runtime/vocabulary/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";

export type MapProviderEventResult =
  | { kind: "mapped"; event: ThreadEvent }
  | { kind: "dropped"; reason: string };

const dropped = (reason: string): MapProviderEventResult => ({ kind: "dropped", reason });

const UNMAPPED_EVENT_TYPES = [
  "item/toolCall/progress",
  "turn/plan/updated",
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
  UnmappedProviderEvent | Extract<ProviderEvent, { type: "provider/error" | "provider/notice" }>
>;

const mapProviderError = (
  event: Extract<ProviderEvent, { type: "provider/error" }>,
  turnId: string | null,
): MapProviderEventResult => ({
  event: {
    message: event.message,
    scope: turnId === null ? threadScope() : turnScope(turnId),
    threadId: event.threadId,
    type: "provider/error",
  },
  kind: "mapped",
});

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
      return {
        event: {
          item: event.item,
          scope: turnScope(turnId),
          threadId: event.threadId,
          type: event.type,
        },
        kind: "mapped",
      };
    }
    case "item/agentMessage/delta":
    case "item/reasoning/textDelta": {
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
  // the agent log is the one place a notice is read until one earns a renderer, so its text rides
  // the reason.
  if (event.type === "provider/notice") {
    return dropped(`${event.type} has no persisted mapping: ${event.severity}: ${event.message}`);
  }
  if (event.type === "provider/error") {
    return mapProviderError(event, turnId);
  }
  if (turnId === null) {
    return dropped(`${event.type} with no host turn bound`);
  }
  return mapTurnEvent(event, turnId);
};
