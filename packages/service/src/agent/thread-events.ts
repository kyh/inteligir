import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import type { CallSettled, Fact, JsonValue, Progress, TurnSettled } from "eve/events";
import { z } from "zod";

import type { KeptTurn } from "./agent-threads";

export interface ThreadPosition {
  readonly session: number;
  readonly line: number;
  readonly index: number;
}

export const cursorOf = ({ index, line, session }: ThreadPosition) =>
  `${String(session)}:${String(line)}:${String(index)}`;

const CURSOR = /^(?<session>\d{1,9}):(?<line>\d{1,9}):(?<index>\d{1,9})$/u;

export const parseCursor = (cursor: string | undefined) => {
  const groups = cursor === undefined ? undefined : CURSOR.exec(cursor)?.groups;

  if (groups?.session === undefined || groups.line === undefined || groups.index === undefined) {
    return null;
  }

  return {
    index: Number(groups.index),
    line: Number(groups.line),
    session: Number(groups.session),
  } satisfies ThreadPosition | null;
};

export const comparePositions = (a: ThreadPosition, b: ThreadPosition) =>
  a.session - b.session || a.line - b.line || a.index - b.index;

const SUMMARY_MAX_CHARS = 2000;

export const agentCallOutcomeSchema = z.object({
  kind: z.enum(["ran", "failed"]),
  text: z.string(),
});

const callIdOf = (session: number, callId: string) => `${String(session)}:${callId}`;

const shownJson = z.json();

const dropEncrypted = (key: string, value: JsonValue) =>
  key === "encryptedContent" ? undefined : value;

const withoutEncrypted = (value: JsonValue) =>
  shownJson.parse(JSON.parse(JSON.stringify(value, dropEncrypted)));

const textOf = (value: JsonValue | undefined) => {
  const text = z.string().nullish().safeParse(value);

  if (text.success) {
    return text.data ?? "";
  }

  return JSON.stringify(value, dropEncrypted);
};

const summarized = (text: string) => text.slice(0, SUMMARY_MAX_CHARS);

const toolResultOf = (session: number, { data }: CallSettled) => {
  const toolUseId = callIdOf(session, data.callId);

  if (data.outcome === "completed") {
    const outcome = agentCallOutcomeSchema.safeParse(data.output);

    return (
      outcome.success
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
          }
    ) satisfies AgentEvent;
  }

  return {
    isError: true,
    summary: summarized(data.error?.message ?? data.reason ?? data.outcome),
    toolUseId,
    type: "agent.tool_result",
  } satisfies AgentEvent;
};

export const shownEvent: (fact: Fact | Progress, session: number) => AgentEvent | null = (
  fact: Fact | Progress,
  session: number,
) => {
  switch (fact.type) {
    case "delivery.consumed": {
      const text = fact.data.parts.flatMap((part) => (part.kind === "text" ? [part.text] : []));

      return (
        text.length === 0 ? null : { text: text.join("\n"), type: "user.message" }
      ) satisfies AgentEvent | null;
    }

    case "content.completed": {
      if (fact.data.kind !== "text") {
        return null;
      }

      return {
        text: textOf(fact.data.value),
        type: fact.data.phase === "narration" ? "agent.progress" : "agent.message",
      } satisfies AgentEvent | null;
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
      } satisfies AgentEvent | null;
    }

    case "call.settled": {
      return toolResultOf(session, fact);
    }

    default: {
      return null;
    }
  }
};

export const turnOutcomeOf = ({ data }: TurnSettled, turn: KeptTurn) => {
  switch (data.outcome) {
    case "completed": {
      return "done" as const;
    }

    case "cancelled": {
      return (turn.stopReason ?? "cancelled") satisfies TurnEndReason;
    }

    case "failed": {
      return "failed" as const;
    }

    default: {
      throw new Error(`unexpected ${String(data.outcome satisfies never)}`);
    }
  }
};

export const turnEndedEvent = (settled: TurnSettled, turn: KeptTurn) =>
  ({
    reason: turnOutcomeOf(settled, turn),
    turn: turn.number,
    type: "turn.ended",
  }) satisfies AgentEvent;

export const draftReader = () => {
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
  } satisfies (event: Fact | Progress) => string | null;
};
