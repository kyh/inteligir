// One tool call of the agent's as its row in the conversation's `tool_calls` holds it
// (`@repo/db/thread/schema`): the row's `state` is this union's kind, read by `toolCallOf` and
// written by `toolCallColumns`, and the one way a call moves is `toolCallNext`, which the loop's
// round, the person's answer and a stop each go through (`./thread-loop`). A call the reply asked
// for runs unless it asks the person first, and one that would ask over input its row refuses is
// journaled answered (`./agent-tools`); one that waits holds the time it is declined at for a
// person who never answers; a denied one is answered that the person declined it whatever answers
// it, its round or a stop; a result lands only on a call that runs.

import type { toolCalls } from "@repo/db/thread/schema";

import type { ToolAnswer } from "./thread-wire";

export const DECLINED = "The person declined this, so it did not run.";
export const STOPPED = "The person stopped this turn before this ran.";

export type ToolCall =
  // journaled, to run without asking the person
  | { readonly kind: "asked" }
  | { readonly kind: "awaiting"; readonly until: number }
  | { readonly kind: "approved" }
  | { readonly kind: "denied" }
  // handed to the cell; met again by a later step, it was cut mid-run and runs again
  | { readonly kind: "running" }
  | { readonly kind: "answered"; readonly answer: ToolAnswer };

export type ToolCallEvent =
  | { readonly kind: "decide"; readonly approved: boolean }
  | { readonly kind: "run" }
  | { readonly kind: "result"; readonly answer: ToolAnswer }
  | { readonly kind: "stop" };

type ToolCallColumns = Pick<
  typeof toolCalls.$inferSelect,
  "isError" | "result" | "state" | "until"
>;

// the row's CHECKs hold a waiting call to its deadline and an answered one to its result
export const toolCallOf = (row: ToolCallColumns): ToolCall => {
  if (row.state === "awaiting") {
    return { kind: "awaiting", until: row.until ?? 0 };
  }
  return row.state === "answered"
    ? { answer: { content: row.result ?? "", isError: row.isError === 1 }, kind: "answered" }
    : { kind: row.state };
};

export const toolCallColumns = (call: ToolCall): ToolCallColumns => ({
  isError: call.kind === "answered" && call.answer.isError ? 1 : 0,
  result: call.kind === "answered" ? call.answer.content : null,
  state: call.kind,
  until: call.kind === "awaiting" ? call.until : null,
});

const DECLINED_CALL: ToolCall = { answer: { content: DECLINED, isError: true }, kind: "answered" };

const STOPPED_CALL: ToolCall = { answer: { content: STOPPED, isError: true }, kind: "answered" };

// the call `event` leaves, or null where the event is none it can take: a decision on a call not
// waiting on the person, a run of one waiting or answered, a result for one not running, a stop of
// one answered
export const toolCallNext = (call: ToolCall, event: ToolCallEvent): ToolCall | null => {
  switch (event.kind) {
    case "decide": {
      if (call.kind !== "awaiting") {
        return null;
      }
      return { kind: event.approved ? "approved" : "denied" };
    }
    case "run": {
      if (call.kind === "denied") {
        return DECLINED_CALL;
      }
      return call.kind === "asked" || call.kind === "approved" || call.kind === "running"
        ? { kind: "running" }
        : null;
    }
    case "result": {
      return call.kind === "running" ? { answer: event.answer, kind: "answered" } : null;
    }
    case "stop": {
      if (call.kind === "answered") {
        return null;
      }
      return call.kind === "denied" ? DECLINED_CALL : STOPPED_CALL;
    }
    // no default
  }
};
