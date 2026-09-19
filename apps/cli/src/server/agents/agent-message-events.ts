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

export const agentMessageEvents = (args: AgentMessageEventArgs): ThreadEvent[] => {
  const { threadId, itemId, text, scope } = args;
  const midpoint = Math.ceil(text.length / 2);
  return [
    {
      item: { id: itemId, text: "", type: "agentMessage" },
      scope,
      threadId,
      type: "item/started",
    },
    {
      delta: text.slice(0, midpoint),
      itemId,
      scope,
      threadId,
      type: "item/agentMessage/delta",
    },
    {
      delta: text.slice(midpoint),
      itemId,
      scope,
      threadId,
      type: "item/agentMessage/delta",
    },
    {
      item: { id: itemId, text, type: "agentMessage" },
      scope,
      threadId,
      type: "item/completed",
    },
  ];
};
