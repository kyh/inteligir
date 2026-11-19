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

const STATUS_WORDS = {
  idle: "",
  running: "Working…",
} satisfies Record<ThreadStatus, string>;

export const statusWords = (status: ThreadStatus) => STATUS_WORDS[status];

export interface ThreadEntry {
  readonly eventId: string;
  readonly at: number;
  readonly event: AgentEvent;
}

const entriesOf = (rows: readonly ThreadEventRow[]) =>
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

export const toolWords = (name: string) =>
  isLibraryToolName(name) || isWebToolName(name) ? TOOL_WORDS[name] : "Used the library";

export const readsOnly = (name: string) =>
  isWebToolName(name) || (isLibraryToolName(name) && LIBRARY_TOOLS[name].reads);

const ENDINGS = {
  allowance: "The agent has used today’s allowance.",
  budget: "The agent has used today’s allowance.",
  cancelled: "Stopped.",
  done: "",
  failed: "The agent ran into a problem and stopped.",
  steps: "Stopped: the agent did as much as one turn may. Ask it to go on.",
  unavailable: "The agent couldn't be reached, so nothing was done.",
} satisfies Record<TurnEndReason, string>;

export const endingWords = (reason: TurnEndReason) => ENDINGS[reason];

export const EMPTY_WORDS = "Ask the agent to file, tag, find or summarize what you have saved.";

export const workWords = (steps: number) => {
  if (steps === 0) {
    return "Thought it through";
  }

  return steps === 1 ? "Worked through 1 step" : `Worked through ${String(steps)} steps`;
};

export const callRefusalWords = (cause: unknown) =>
  refusalText(cause, "The agent couldn't be reached.");

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const resetsAtSchema = z.object({ resetsAt: z.number().int().nonnegative() });

const backAt = (resetsAt: number | null, nowMs: number) =>
  resetsAt !== null && resetsAt > nowMs ? ` It’s back at ${TIME.format(resetsAt)}.` : "";

export const sendRefusalWords = (cause: unknown, nowMs: number) => {
  if (!isOrpcError(cause) || !cause.defined) {
    return callRefusalWords(cause);
  }

  const named = resetsAtSchema.safeParse(cause.data);
  const resetsAt = named.success ? named.data.resetsAt : null;

  if (cause.code === "AGENT_BUDGET") {
    return `The agent has used today’s allowance.${backAt(resetsAt, nowMs)}`;
  }

  if (cause.code === "SERVICE_UNAVAILABLE") {
    return resetsAt === null
      ? "The built-in agent is off or can’t be reached right now. You can turn it on in Settings."
      : `The built-in agent is at capacity for today.${backAt(resetsAt, nowMs)}`;
  }

  return callRefusalWords(cause);
};

type ToolUse = { readonly toolUseId: string; readonly name: string } & (
  | { readonly kind: "running" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string }
);

const toolUseNext = (
  use: ToolUse,
  { isError, summary }: Extract<AgentEvent, { type: "agent.tool_result" }>,
) => {
  if (use.kind !== "running") {
    return null;
  }

  const { name, toolUseId } = use;

  return (
    isError
      ? { kind: "failed", message: summary, name, toolUseId }
      : { kind: "done", name, toolUseId }
  ) satisfies ToolUse | null;
};

interface WorkNote {
  readonly eventId: string;
  readonly text: string;
}

interface EntryBlock {
  readonly kind: "entry";
  readonly key: string;
  readonly entry: ThreadEntry;
}

export type ThreadBlock =
  | EntryBlock
  | {
      readonly kind: "work";
      readonly key: string;
      readonly notes: readonly WorkNote[];
      readonly uses: readonly ToolUse[];
    }
  | { readonly kind: "draft"; readonly key: string; readonly text: string };

interface Run {
  readonly kind: "run";
  readonly key: string;
  readonly notes: WorkNote[];
  readonly useIds: string[];
}

interface Conversation {
  readonly blocks: readonly ThreadBlock[];
  readonly underWay: boolean;
}

export const conversationOf = (rows: readonly ThreadEventRow[], draft: string) => {
  const uses = new Map<string, ToolUse>();
  const drafts: (Run | EntryBlock)[] = [];
  let run: Run | null = null;
  let underWay = false;

  const openRun = (key: string) => {
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

      default: {
        throw new Error(`unexpected ${String(event satisfies never)}`);
      }
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
  } satisfies Conversation;
};
