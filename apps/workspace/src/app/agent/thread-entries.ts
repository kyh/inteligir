// A conversation with the built-in agent as the panel reads it: the thread's stored events, each
// parsed by the one union every device reads (`@repo/contract/cloud/library/agent-events`), and
// what they say together (the approval still waiting, how each turn ended). An event this build
// cannot parse is skipped, so a newer cell may add kinds. The words for each refusal and each
// ending are the person's, never the wire's.

import { agentEventSchema } from "@repo/contract/cloud/library/agent-events";
import type { AgentEvent, TurnEndReason } from "@repo/contract/cloud/library/agent-events";
import type { threadEventRowSchema } from "@repo/contract/cloud/library/library-wire";
import { ORPCError } from "@orpc/client";
import { z } from "zod";

type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

export interface ThreadEntry {
  readonly eventId: string;
  readonly at: number;
  readonly event: AgentEvent;
}

export const threadEntries = (rows: readonly ThreadEventRow[]): ThreadEntry[] =>
  rows
    .toSorted((a, b) => a.idx - b.idx)
    .flatMap((row) => {
      const parsed = agentEventSchema.safeParse(row.event);
      return parsed.success ? [{ at: row.at, event: parsed.data, eventId: row.eventId }] : [];
    });

// an approval the person has not answered: the `approval.asked` event `respond` names
export interface WaitingApproval {
  readonly eventId: string;
  readonly name: string;
  readonly until: number;
}

export const waitingApprovals = (entries: readonly ThreadEntry[]): WaitingApproval[] => {
  const answered = new Set(
    entries.flatMap(({ event }) => (event.type === "approval.answered" ? [event.toolUseId] : [])),
  );
  return entries.flatMap(({ event, eventId }) =>
    event.type === "approval.asked" && !answered.has(event.toolUseId)
      ? [{ eventId, name: event.name, until: event.until }]
      : [],
  );
};

// what a tool's name says to the person
const TOOL_WORDS = new Map([
  ["add_highlight", "Highlighted a passage"],
  ["create_note", "Wrote a note"],
  ["delete_items", "Moved items to Deleted"],
  ["edit_item", "Edited an item"],
  ["item_history", "Read an item's history"],
  ["list_highlights", "Read the highlights"],
  ["list_items", "Looked through the library"],
  ["list_tags_and_folders", "Read the folders and tags"],
  ["organize_items", "Filed items"],
  ["read_item", "Read an item"],
  ["save_link", "Saved a link"],
  ["search_library", "Searched the library"],
]);

export const toolWords = (name: string): string => TOOL_WORDS.get(name) ?? "Used the library";

// what an approval asks, in a sentence
export const approvalQuestion = (approval: WaitingApproval): string =>
  approval.name === "delete_items"
    ? "The agent wants to move items to Deleted. You can restore them from there."
    : `The agent wants to: ${toolWords(approval.name).toLowerCase()}.`;

const ENDINGS = {
  budget: "Stopped: the agent reached what it may spend on one turn or one day.",
  cancelled: "Stopped.",
  done: "",
  failed: "The agent ran into a problem and stopped.",
  max_tokens: "The reply ran out of room and was cut off.",
  model_context_window_exceeded: "This conversation grew too long to go on. Start a new one.",
  refusal: "The agent declined to go on with this.",
  unavailable: "The agent couldn't be reached, so nothing was done.",
} satisfies Record<TurnEndReason, string>;

// how a turn ended, as the panel says it; "" for a turn that simply finished
export const endingWords = (reason: TurnEndReason): string => ENDINGS[reason];

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// AGENT_BUDGET's data as the wire declares it
const budgetDataSchema = z.object({ resetsAt: z.number().int().nonnegative() });

// what a send the cell refused says: the allowance and when it fills again, or the agent off or
// out of reach; null for a refusal that is not the agent's own
export const agentRefusalWords = (cause: unknown, nowMs: number): string | null => {
  if (!(cause instanceof ORPCError) || !cause.defined) {
    return null;
  }
  if (cause.code === "AGENT_BUDGET") {
    const budget = budgetDataSchema.safeParse(cause.data);
    const resetsAt = budget.success ? budget.data.resetsAt : null;
    const when =
      resetsAt !== null && resetsAt > nowMs ? ` It’s back at ${TIME.format(resetsAt)}.` : "";
    return `The agent has used today’s allowance.${when}`;
  }
  if (cause.code === "SERVICE_UNAVAILABLE") {
    return "The built-in agent is off or can’t be reached right now. You can turn it on in Settings.";
  }
  return null;
};
