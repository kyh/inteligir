// What eve records, as a thread shows it: each fact mapped into the contract's own event union,
// never kept raw, by the record hook as it keeps it (`./eve-agent`) and by the relay as it happens
// (`./relay`), so both show one event at one position. A thread outlives its eve sessions and eve's
// call ids repeat across them, so a call's id carries its session's number. A turn's end names the
// thread's turn, which both read from its row.

import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import type { agentTurn } from "@repo/db/agent-schema";
import type { CallSettled, Fact, JsonValue, Progress, TurnSettled } from "eve/events";
import { z } from "zod";

// where eve recorded a fact: the thread's session by its number, the line, the index in that line
export interface ThreadPosition {
  readonly session: number;
  readonly line: number;
  readonly index: number;
}

// a thread event's id, as a device holds it and sends it back to resume
export const cursorOf = ({ index, line, session }: ThreadPosition): string =>
  `${String(session)}:${String(line)}:${String(index)}`;

const CURSOR = /^(?<session>\d{1,9}):(?<line>\d{1,9}):(?<index>\d{1,9})$/u;

// null for anything else: no id, or one this cloud never minted
export const parseCursor = (cursor: string | undefined): ThreadPosition | null => {
  const groups = cursor === undefined ? undefined : CURSOR.exec(cursor)?.groups;
  if (groups?.session === undefined || groups.line === undefined || groups.index === undefined) {
    return null;
  }
  return {
    index: Number(groups.index),
    line: Number(groups.line),
    session: Number(groups.session),
  };
};

// positive when `a` was recorded after `b`
export const comparePositions = (a: ThreadPosition, b: ThreadPosition): number =>
  a.session - b.session || a.line - b.line || a.index - b.index;

// how a turn ended as its row keeps it and its `turn.ended` event says it
export type TurnOutcome = NonNullable<(typeof agentTurn.$inferSelect)["outcome"]> & TurnEndReason;

// a tool's result as a thread shows it; the agent read it whole
const SUMMARY_MAX_CHARS = 2000;

// a library tool answers its outcome as data (`./agent-tools`), so a call eve completed may still
// have been refused
export const agentCallOutcomeSchema = z.object({
  kind: z.enum(["ran", "failed"]),
  text: z.string(),
});

const callIdOf = (session: number, callId: string): string => `${String(session)}:${callId}`;

const shownJson = z.json();
type ShownJson = z.infer<typeof shownJson>;

// a native search's results carry an encrypted copy of each page for the provider alone
const dropEncrypted = (key: string, value: JsonValue): JsonValue | undefined =>
  key === "encryptedContent" ? undefined : value;

const withoutEncrypted = (value: JsonValue): ShownJson =>
  shownJson.parse(JSON.parse(JSON.stringify(value, dropEncrypted)));

const textOf = (value: JsonValue | undefined): string => {
  const text = z.string().nullish().safeParse(value);
  if (text.success) {
    return text.data ?? "";
  }
  return JSON.stringify(value, dropEncrypted);
};

const summarized = (text: string): string => text.slice(0, SUMMARY_MAX_CHARS);

const toolResultOf = (session: number, { data }: CallSettled): AgentEvent => {
  const toolUseId = callIdOf(session, data.callId);
  if (data.outcome === "completed") {
    const outcome = agentCallOutcomeSchema.safeParse(data.output);
    return outcome.success
      ? {
          isError: outcome.data.kind !== "ran",
          summary: summarized(outcome.data.text),
          toolUseId,
          type: "agent.tool_result",
        }
      : {
          isError: false,
          summary: summarized(textOf(data.output)),
          toolUseId,
          type: "agent.tool_result",
        };
  }
  return {
    isError: true,
    summary: summarized(data.error?.message ?? data.reason ?? data.outcome),
    toolUseId,
    type: "agent.tool_result",
  };
};

// what a thread shows of one recorded fact, or null for what it doesn't; a turn's start and end are
// the record hook's, which knows the turn's number
export const shownEvent = (fact: Fact | Progress, session: number): AgentEvent | null => {
  switch (fact.type) {
    case "delivery.consumed": {
      const text = fact.data.parts.flatMap((part) => (part.kind === "text" ? [part.text] : []));
      return text.length === 0 ? null : { text: text.join("\n"), type: "user.message" };
    }
    case "content.completed": {
      if (fact.data.kind !== "text") {
        return null;
      }
      return {
        text: textOf(fact.data.value),
        type: fact.data.phase === "narration" ? "agent.progress" : "agent.message",
      };
    }
    case "call.requested": {
      const { callId, capability, input } = fact.data;
      if (capability.kind === "control" || capability.hidden === true) {
        return null;
      }
      return {
        input: input === undefined ? {} : withoutEncrypted(input),
        name: capability.name,
        toolUseId: callIdOf(session, callId),
        type: "agent.tool_use",
      };
    }
    case "call.settled": {
      return toolResultOf(session, fact);
    }
    default: {
      return null;
    }
  }
};

// how a turn eve settled ended, as its row and its thread keep it
export const turnOutcomeOf = ({ data }: TurnSettled): TurnOutcome => {
  switch (data.outcome) {
    case "completed": {
      return "done";
    }
    case "cancelled": {
      return "cancelled";
    }
    case "failed": {
      return "failed";
    }
    // no default
  }
};

// the thread's event for a turn eve settled, its number the thread's
export const turnEndedEvent = (settled: TurnSettled, turn: number): AgentEvent => ({
  reason: turnOutcomeOf(settled),
  turn,
  type: "turn.ended",
});

// The agent's text as it is written, piece by piece: only a part this stream saw begin, whose first
// piece names it text, since one begun before the stream opened would show from its middle; its
// recorded event replaces what its pieces built
export const draftReader = (): ((event: Fact | Progress) => string | null) => {
  const drafting = new Set<string>();
  return function draftOf(event) {
    if (event.type !== "content.delta") {
      return null;
    }
    const { delta, kind, partId } = event.data;
    if (kind === "text") {
      drafting.add(partId);
    }
    return drafting.has(partId) ? delta : null;
  };
};
