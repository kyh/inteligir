// A conversation with the built-in agent as every device's panel reads it: the thread's stored
// events, each parsed by the one union every device reads
// (`@repo/contract/library/agent-events`), and what they say together (`conversationOf`: the
// approvals still waiting, how each turn ended, the runs of work between two messages). An event
// this build cannot parse is skipped, so a newer cell may add kinds. The words for each refusal,
// each ending and each thread's state are the person's, never the wire's; each device draws them
// its own way.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import type { THREAD_STATUSES, threadEventRowSchema } from "@repo/contract/library/library-wire";
import { refusalText } from "@repo/contract/refusal-text";
import { cleanUrl, urlHost } from "@repo/contract/items/item-url";
import { z } from "zod";
import { isOrpcError } from "@repo/contract/v1/errors";

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

// the agent is at work or about to be
export const isWorking = (status: ThreadStatus): boolean =>
  status === "running" || status === "queued";

// a turn is open, a turn waiting on the person among them: Stop ends it, turning down what it
// asked, and the page's Undo waits for it, since its change set seals only as it ends
export const isUnderWay = (status: ThreadStatus): boolean => status !== "idle";

export interface ThreadEntry {
  readonly eventId: string;
  readonly at: number;
  readonly event: AgentEvent;
}

const entriesOf = (rows: readonly ThreadEventRow[]): ThreadEntry[] =>
  rows
    .toSorted((a, b) => a.idx - b.idx)
    .flatMap((row) => {
      const parsed = agentEventSchema.safeParse(row.event);
      return parsed.success ? [{ at: row.at, event: parsed.data, eventId: row.eventId }] : [];
    });

// what a call waiting on the person would do, read off its input: the items a delete would move,
// the address a save would reach as the library would read it, or nothing this build can say
type ApprovalAsk =
  | { readonly kind: "delete"; readonly ids: readonly string[] }
  | { readonly kind: "save"; readonly host: string; readonly url: string }
  | { readonly kind: "unread" };

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
  return url === null || host === null ? { kind: "unread" } : { host, kind: "save", url };
};

// an approval the person has not answered: the `approval.asked` event `respond` names
export interface WaitingApproval {
  readonly ask: ApprovalAsk;
  readonly eventId: string;
}

// a call that waited on the person: it waits until they answer it or its turn ends, which lapses
// it, since an ended turn runs nothing more and a card left up would answer nothing
type Approval =
  | ({ readonly kind: "waiting" } & WaitingApproval)
  | { readonly kind: "answered" }
  | { readonly kind: "lapsed" };

type ApprovalEvent = Extract<
  AgentEvent,
  { type: "approval.asked" | "approval.answered" | "turn.ended" }
>;

// the approval an event leaves: asked once, answered only while it waits, lapsed by its turn's
// end; an answer to a call never asked leaves none
const approvalNext = (
  approval: Approval | undefined,
  event: ApprovalEvent,
  eventId: string,
): Approval | undefined => {
  switch (event.type) {
    case "approval.asked": {
      return approval ?? { ask: askOf(event), eventId, kind: "waiting" };
    }
    case "approval.answered": {
      return approval?.kind === "waiting" ? { kind: "answered" } : approval;
    }
    case "turn.ended": {
      return approval?.kind === "waiting" ? { kind: "lapsed" } : approval;
    }
    // no default
  }
};

// what a tool's name says to the person
const TOOL_WORDS = new Map([
  ["create_note", "Wrote a note"],
  ["delete_items", "Moved items to Deleted"],
  ["edit_item", "Edited an item"],
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
    case "unread": {
      return { detail: null, question: "The agent wants to use the library." };
    }
    // no default
  }
};

const ENDINGS = {
  budget: "Stopped: the agent did as much as one turn may. Ask it to go on.",
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

// what a screen with no conversation on it says
export const EMPTY_WORDS = "Ask the agent to file, tag, find or summarize what you have saved.";

type ApprovalAnswer = Extract<AgentEvent, { type: "approval.answered" }>;

const DENIALS = {
  cancel: "Stopped before you answered, so it didn't run.",
  person: "Declined.",
  timeout: "Not answered in time, so it didn't run.",
} satisfies Record<ApprovalAnswer["by"], string>;

// how an approval was settled: the person's answer, its time running out, or the turn stopped
export const answerWords = ({ by, result }: Pick<ApprovalAnswer, "by" | "result">): string =>
  result === "allow" ? "Allowed." : DENIALS[by];

// a finished run of work in a line, by the calls it made
export const workWords = (steps: number): string => {
  if (steps === 0) {
    return "Thought it through";
  }
  return steps === 1 ? "Worked through 1 step" : `Worked through ${String(steps)} steps`;
};

// a refused call to the agent: the sentence the refusal declares, else that it was not reached
export const callRefusalWords = (cause: unknown): string =>
  refusalText(cause, "The agent couldn't be reached.");

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// AGENT_BUDGET's data as the wire declares it
const budgetDataSchema = z.object({ resetsAt: z.number().int().nonnegative() });

// what a send the cell refused says: the allowance and when it fills again, the agent off or out
// of reach, or any other refused call's words
export const sendRefusalWords = (cause: unknown, nowMs: number): string => {
  if (!isOrpcError(cause) || !cause.defined) {
    return callRefusalWords(cause);
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
  return callRefusalWords(cause);
};

// one call the agent made, as a run of work shows it: running until its result lands, which says
// whether it failed, and in its first characters why
export type ToolUse = { readonly toolUseId: string; readonly name: string } & (
  | { readonly kind: "running" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string }
);

// the use a result leaves: one result lands, on a call still running
const toolUseNext = (
  use: ToolUse,
  { isError, summary }: Extract<AgentEvent, { type: "agent.tool_result" }>,
): ToolUse | null => {
  if (use.kind !== "running") {
    return null;
  }
  const { name, toolUseId } = use;
  return isError
    ? { kind: "failed", message: summary, name, toolUseId }
    : { kind: "done", name, toolUseId };
};

// a progress note of the agent's, keyed by the event that carried it
interface WorkNote {
  readonly eventId: string;
  readonly text: string;
}

interface EntryBlock {
  readonly kind: "entry";
  readonly key: string;
  readonly entry: ThreadEntry;
}

// what a conversation draws, in order: a message either way, a run of the agent's work between
// them (its notes and its calls), an answered approval, and a turn's end
export type ThreadBlock =
  | EntryBlock
  | {
      readonly kind: "work";
      readonly key: string;
      readonly notes: readonly WorkNote[];
      readonly uses: readonly ToolUse[];
    };

// a run of work as it is read, its calls named by id until every result is in
interface Run {
  readonly kind: "run";
  readonly key: string;
  readonly notes: WorkNote[];
  readonly useIds: string[];
}

// a conversation as every device draws it: its blocks, and the approvals still waiting on the
// person, in the order they were asked
export interface Conversation {
  readonly blocks: readonly ThreadBlock[];
  readonly waiting: readonly WaitingApproval[];
}

// a thread's stored events read once, in order. A result lands on its call wherever that call's
// run is, since a call that waited on the person answers after an asked approval closed its run;
// an answer or a result before its ask or its call is skipped
export const conversationOf = (rows: readonly ThreadEventRow[]): Conversation => {
  const approvals = new Map<string, Approval>();
  const uses = new Map<string, ToolUse>();
  const drafts: (Run | EntryBlock)[] = [];
  let run: Run | null = null;
  const openRun = (key: string): Run => {
    const opened: Run = { key, kind: "run", notes: [], useIds: [] };
    drafts.push(opened);
    return opened;
  };
  for (const entry of entriesOf(rows)) {
    const { event, eventId } = entry;
    switch (event.type) {
      case "agent.progress": {
        run ??= openRun(eventId);
        run.notes.push({ eventId, text: event.text });
        break;
      }
      case "agent.tool_use": {
        run ??= openRun(eventId);
        if (!uses.has(event.toolUseId)) {
          const { name, toolUseId } = event;
          uses.set(toolUseId, { kind: "running", name, toolUseId });
          run.useIds.push(toolUseId);
        }
        break;
      }
      case "agent.tool_result": {
        const use = uses.get(event.toolUseId);
        const next = use === undefined ? null : toolUseNext(use, event);
        if (next !== null) {
          uses.set(event.toolUseId, next);
        }
        break;
      }
      // an asked approval is drawn as the card that answers it, never as a row
      case "approval.asked":
      case "approval.answered": {
        run = null;
        const before = approvals.get(event.toolUseId);
        const after = approvalNext(before, event, eventId);
        if (after !== undefined && after !== before) {
          approvals.set(event.toolUseId, after);
          if (event.type === "approval.answered") {
            drafts.push({ entry, key: eventId, kind: "entry" });
          }
        }
        break;
      }
      case "turn.ended": {
        run = null;
        for (const [toolUseId, approval] of approvals) {
          approvals.set(toolUseId, approvalNext(approval, event, eventId) ?? approval);
        }
        drafts.push({ entry, key: eventId, kind: "entry" });
        break;
      }
      case "user.message":
      case "agent.message": {
        run = null;
        drafts.push({ entry, key: eventId, kind: "entry" });
        break;
      }
      // no default
    }
  }
  return {
    blocks: drafts.map((draft) =>
      draft.kind === "entry"
        ? draft
        : {
            key: draft.key,
            kind: "work",
            notes: draft.notes,
            uses: draft.useIds.flatMap((toolUseId) => {
              const use = uses.get(toolUseId);
              return use === undefined ? [] : [use];
            }),
          },
    ),
    waiting: [...approvals.values()].flatMap((approval) =>
      approval.kind === "waiting" ? [{ ask: approval.ask, eventId: approval.eventId }] : [],
    ),
  };
};

// the calls that only read the library, drawn with the read icon; every other one writes
const READS = new Set(["list_items", "list_tags_and_folders", "read_item", "search_library"]);

export const readsOnly = (name: string): boolean => READS.has(name);
