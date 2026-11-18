// A conversation with the built-in agent as every device's panel reads it: the thread's events as
// they stream, each parsed by the one union every device reads
// (`@repo/contract/library/agent-events`), and what they say together (`conversationOf`: whether a
// turn is under way, how each turn ended, the runs of work between two messages, the reply as it
// is written). An event this build cannot parse is skipped, so a newer cloud may add kinds. The
// words for each refusal, each ending and each thread's state are the person's, never the wire's;
// each device draws them its own way.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import {
  isLibraryToolName,
  isWebToolName,
  LIBRARY_TOOLS,
} from "@repo/contract/library/agent-tools";
import type { LibraryToolName, WebToolName } from "@repo/contract/library/agent-tools";
import type { THREAD_STATUSES, threadEventRowSchema } from "@repo/contract/library/library-wire";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { z } from "zod";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";

type ThreadEventRow = z.infer<typeof threadEventRowSchema>;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

// what a thread's state says beside it in a list or under its conversation; "" while it rests
const STATUS_WORDS = {
  idle: "",
  running: "Working…",
} satisfies Record<ThreadStatus, string>;

export const statusWords = (status: ThreadStatus): string => STATUS_WORDS[status];

export interface ThreadEntry {
  readonly eventId: string;
  readonly at: number;
  readonly event: AgentEvent;
}

const entriesOf = (rows: readonly ThreadEventRow[]): ThreadEntry[] =>
  rows.flatMap((row) => {
    const parsed = agentEventSchema.safeParse(row.event);
    return parsed.success ? [{ at: row.at, event: parsed.data, eventId: row.eventId }] : [];
  });

const TOOL_WORDS = {
  create_note: "Wrote a note",
  delete_items: "Moved items to Deleted",
  edit_item: "Edited an item",
  list_items: "Looked through the library",
  list_tags_and_folders: "Read the folders and tags",
  organize_items: "Filed items",
  read_item: "Read an item",
  save_link: "Saved a link",
  search_library: "Searched the library",
  web_fetch: "Read a page",
  web_search: "Searched the web",
} satisfies Record<LibraryToolName | WebToolName, string>;

// what a tool's name says to the person; a tool a newer cloud names used the library
export const toolWords = (name: string): string =>
  isLibraryToolName(name) || isWebToolName(name) ? TOOL_WORDS[name] : "Used the library";

// a call that changes nothing in the library, drawn with the read icon; every other one writes
export const readsOnly = (name: string): boolean =>
  isWebToolName(name) || (isLibraryToolName(name) && LIBRARY_TOOLS[name].reads);

// the day's turns and its spend are one allowance to the person
const ENDINGS = {
  allowance: "The agent has used today’s allowance.",
  budget: "The agent has used today’s allowance.",
  cancelled: "Stopped.",
  done: "",
  failed: "The agent ran into a problem and stopped.",
  steps: "Stopped: the agent did as much as one turn may. Ask it to go on.",
  unavailable: "The agent couldn't be reached, so nothing was done.",
} satisfies Record<TurnEndReason, string>;

// how a turn ended, as the panel says it; "" for a turn that simply finished
export const endingWords = (reason: TurnEndReason): string => ENDINGS[reason];

// what a screen with no conversation on it says
export const EMPTY_WORDS = "Ask the agent to file, tag, find or summarize what you have saved.";

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
type ToolUse = { readonly toolUseId: string; readonly name: string } & (
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
// them (its notes and its calls), a turn's end, and last the reply as it is written
export type ThreadBlock =
  | EntryBlock
  | {
      readonly kind: "work";
      readonly key: string;
      readonly notes: readonly WorkNote[];
      readonly uses: readonly ToolUse[];
    }
  | { readonly kind: "draft"; readonly key: string; readonly text: string };

// a run of work as it is read, its calls named by id until every result is in
interface Run {
  readonly kind: "run";
  readonly key: string;
  readonly notes: WorkNote[];
  readonly useIds: string[];
}

// a conversation as every device draws it: its blocks, and whether a turn is under way, read off
// the events, since a message sent mid-turn joins it: Stop ends it, and Undo waits for it, since
// its change set seals only as it ends
export interface Conversation {
  readonly blocks: readonly ThreadBlock[];
  readonly underWay: boolean;
}

// a thread's events read once, in order, with what the agent has written of its reply since the
// last of them; a result before its call is skipped
export const conversationOf = (rows: readonly ThreadEventRow[], draft: string): Conversation => {
  const uses = new Map<string, ToolUse>();
  const drafts: (Run | EntryBlock)[] = [];
  let run: Run | null = null;
  let underWay = false;
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
      case "turn.ended": {
        run = null;
        underWay = false;
        drafts.push({ entry, key: eventId, kind: "entry" });
        break;
      }
      case "user.message": {
        run = null;
        underWay = true;
        drafts.push({ entry, key: eventId, kind: "entry" });
        break;
      }
      case "agent.message": {
        run = null;
        drafts.push({ entry, key: eventId, kind: "entry" });
        break;
      }
      // no default
    }
  }
  const blocks: ThreadBlock[] = drafts.map((block) =>
    block.kind === "entry"
      ? block
      : {
          key: block.key,
          kind: "work",
          notes: block.notes,
          uses: block.useIds.flatMap((toolUseId) => {
            const use = uses.get(toolUseId);
            return use === undefined ? [] : [use];
          }),
        },
  );
  return {
    blocks: draft === "" ? blocks : [...blocks, { key: "draft", kind: "draft", text: draft }],
    underWay,
  };
};
