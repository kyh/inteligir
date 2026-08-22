// The fabricated agent-message burst the scripted driver and the test fake
// both stream: item/started, two deltas split at the midpoint, item/completed.
// Returns events and never ingests — the callers batch differently (the fake
// emits turn/started as its own call, scripted folds it into one batch), and
// folding ingest in here would silently change those transaction boundaries.
// Domain-types only: the test fake imports this, and a module graph that
// reached the vault or git would drag them into every route suite's runtime.

import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";

export interface AgentMessageEventArgs {
  threadId: string;
  itemId: string;
  text: string;
  scope: ThreadEventScope;
}

export function agentMessageEvents(args: AgentMessageEventArgs): ThreadEvent[] {
  const { threadId, itemId, text, scope } = args;
  const midpoint = Math.ceil(text.length / 2);
  return [
    {
      type: "item/started",
      threadId,
      item: { type: "agentMessage", id: itemId, text: "" },
      scope,
    },
    {
      type: "item/agentMessage/delta",
      threadId,
      itemId,
      delta: text.slice(0, midpoint),
      scope,
    },
    {
      type: "item/agentMessage/delta",
      threadId,
      itemId,
      delta: text.slice(midpoint),
      scope,
    },
    {
      type: "item/completed",
      threadId,
      item: { type: "agentMessage", id: itemId, text },
      scope,
    },
  ];
}
