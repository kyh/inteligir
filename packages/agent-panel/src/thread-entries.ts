// A conversation with the built-in agent as every device's panel reads it: the thread's stored
// events, each parsed by the one union every device reads
// (`@repo/contract/cloud/library/agent-events`), and what they say together (the approval still
// waiting, how each turn ended, the runs of work between two messages). An event this build cannot
// parse is skipped, so a newer cell may add kinds. The words for each refusal, each ending and each
// thread's state are the person's, never the wire's; each device draws them its own way.

import { agentEventSchema } from "@repo/contract/cloud/library/agent-events";
import type { AgentEvent, TurnEndReason } from "@repo/contract/cloud/library/agent-events";
import type {
  THREAD_STATUSES,
  threadEventRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import { cleanUrl, urlHost } from "@repo/notes/items/item-url";
import { z } from "zod";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

type ThreadEventRow = z.infer<typeof threadEventRowSchema>;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

// what a thread's state says beside it in a list or under its conversation; "" while it rests
const STATUS_WORDS = {
  awaiting_approval: "Waiting for you",
  idle: "",
  queued: "Waiting its turn…",
  running: "Working…",
} satisfies Record<ThreadStatus, string>;

export const statusWords = (status: ThreadStatus): string => STATUS_WORDS[status];

// the agent is at work or about to be, which Stop ends; a turn waiting on the person is under way
// too, but its approval card is what answers it
export const isWorking = (status: ThreadStatus): boolean =>
  status === "running" || status === "queued";

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

// what a call waiting on the person would do, read off its input: the items a delete would move,
// the address a save would reach as the library would read it, or for a call this build cannot
// read, whose input the cell refuses too, only its tool
type ApprovalAsk =
  | { readonly kind: "delete"; readonly ids: readonly string[] }
  | { readonly kind: "save"; readonly host: string; readonly url: string }
  | { readonly kind: "other"; readonly name: string };

const deleteInputSchema = z.object({ ids: z.array(z.string()).min(1) });
const saveInputSchema = z.object({ url: z.string() });

const askOf = ({ input, name }: Extract<AgentEvent, { type: "approval.asked" }>): ApprovalAsk => {
  const deleting = name === "delete_items" ? deleteInputSchema.safeParse(input) : null;
  if (deleting?.success === true) {
    return { ids: [...new Set(deleting.data.ids)], kind: "delete" };
  }
  const saving = name === "save_link" ? saveInputSchema.safeParse(input) : null;
  const url = saving?.success === true ? cleanUrl(saving.data.url) : null;
  const host = url === null ? null : urlHost(url);
  return url === null || host === null ? { kind: "other", name } : { host, kind: "save", url };
};

// an approval the person has not answered: the `approval.asked` event `respond` names
export interface WaitingApproval {
  readonly ask: ApprovalAsk;
  readonly eventId: string;
  readonly until: number;
}

export const waitingApprovals = (entries: readonly ThreadEntry[]): WaitingApproval[] => {
  const answered = new Set(
    entries.flatMap(({ event }) => (event.type === "approval.answered" ? [event.toolUseId] : [])),
  );
  return entries.flatMap(({ event, eventId }) =>
    event.type === "approval.asked" && !answered.has(event.toolUseId)
      ? [{ ask: askOf(event), eventId, until: event.until }]
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

// the most of a delete's items a card names; the rest it counts
const TITLES_SHOWN = 10;

// the first of a delete's items this device holds a title for, and how many that leaves unnamed
const namedItems = (
  ids: readonly string[],
  titleOf: (id: string) => string | null,
): string | null => {
  const titles = ids.slice(0, TITLES_SHOWN).flatMap((id) => {
    const title = titleOf(id);
    return title === null || title === "" ? [] : [title];
  });
  if (titles.length === 0) {
    return null;
  }
  const rest = ids.length - titles.length;
  return rest === 0 ? titles.join(", ") : `${titles.join(", ")} and ${String(rest)} more`;
};

// what a card asks, and what it shows the person before they answer: the one gate on a call a
// hostile page may have prompted, so it says what the call would do, never what the agent says of it
interface ApprovalWords {
  readonly question: string;
  readonly detail: string | null;
}

export const approvalWords = (
  { ask }: WaitingApproval,
  titleOf: (id: string) => string | null,
): ApprovalWords => {
  switch (ask.kind) {
    case "delete": {
      const one = ask.ids.length === 1;
      return {
        detail: namedItems(ask.ids, titleOf),
        question: one
          ? "The agent wants to move an item to Deleted. You can restore it from there."
          : `The agent wants to move ${String(ask.ids.length)} items to Deleted. You can restore them from there.`,
      };
    }
    case "save": {
      return {
        detail: ask.url,
        question: `The agent wants to save a link from ${ask.host}. Reading its page shows that site this whole address.`,
      };
    }
    case "other": {
      return {
        detail: null,
        question: `The agent wants to: ${toolWords(ask.name).toLowerCase()}.`,
      };
    }
    // no default
  }
};

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
  if (!isOrpcError(cause) || !cause.defined) {
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

// one call the agent made, as a run of work shows it
export interface ToolUse {
  readonly toolUseId: string;
  readonly name: string;
  // the result's first characters when the call failed, null while it runs or once it landed
  readonly failure: string | null;
  readonly answered: boolean;
}

// a progress note of the agent's, keyed by the event that carried it
interface WorkNote {
  readonly eventId: string;
  readonly text: string;
}

// what a conversation draws, in order: a message either way, a run of the agent's work between
// them (its notes and its calls), an answered approval, and a turn's end
export type ThreadBlock =
  | { readonly kind: "entry"; readonly key: string; readonly entry: ThreadEntry }
  | {
      readonly kind: "work";
      readonly key: string;
      readonly notes: readonly WorkNote[];
      readonly uses: readonly ToolUse[];
    };

const isWork = (entry: ThreadEntry): boolean =>
  entry.event.type === "agent.progress" ||
  entry.event.type === "agent.tool_use" ||
  entry.event.type === "agent.tool_result";

export const threadBlocks = (entries: readonly ThreadEntry[]): ThreadBlock[] => {
  const blocks: ThreadBlock[] = [];
  let notes: WorkNote[] = [];
  let uses: ToolUse[] = [];
  let key: string | null = null;
  const close = (): void => {
    if (key !== null) {
      blocks.push({ key, kind: "work", notes, uses });
    }
    notes = [];
    uses = [];
    key = null;
  };
  for (const entry of entries) {
    if (!isWork(entry)) {
      close();
      // an asked approval is drawn as the card that answers it, never as a row
      if (entry.event.type !== "approval.asked") {
        blocks.push({ entry, key: entry.eventId, kind: "entry" });
      }
      continue;
    }
    key ??= entry.eventId;
    const { event } = entry;
    if (event.type === "agent.progress") {
      notes.push({ eventId: entry.eventId, text: event.text });
    } else if (event.type === "agent.tool_use") {
      uses.push({ answered: false, failure: null, name: event.name, toolUseId: event.toolUseId });
    } else if (event.type === "agent.tool_result") {
      uses = uses.map((use) =>
        use.toolUseId === event.toolUseId
          ? { ...use, answered: true, failure: event.isError ? event.summary : null }
          : use,
      );
    }
  }
  close();
  return blocks;
};

// the calls that only read the library, drawn with the read icon; every other one writes
const READS = new Set([
  "item_history",
  "list_highlights",
  "list_items",
  "list_tags_and_folders",
  "read_item",
  "search_library",
]);

export const readsOnly = (name: string): boolean => READS.has(name);
