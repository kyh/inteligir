// returns events and never ingests: the callers batch differently, and ingesting here would change their
// transaction boundaries. domain types only: the test fake imports this.

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
