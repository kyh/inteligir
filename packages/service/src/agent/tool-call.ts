// One tool call of the agent's as its row in the conversation's `tool_calls` holds it
// (`@repo/db/thread/schema`): the `status` and `decision` columns read together as the one state
// they mean, and the one way a call moves (`toolCallNext`), which the loop's round, the person's
// answer and a stop each go through (`./thread-loop`). A call the reply asked for runs unless it
// asks the person first; a denied one is answered with the person's words whatever answers it,
// its round or a stop; a result lands only on a call that runs.

import type { toolCalls } from "@repo/db/thread/schema";

import type { ToolAnswer } from "./thread-wire";

/** @internal */
export const DECLINED = "The person declined this, so it did not run.";
/** @internal */
export const STOPPED = "The person stopped this turn before this ran.";

export type ToolCall =
  // journaled, to run without asking the person
  | { readonly kind: "asked" }
  | { readonly kind: "awaiting" }
  | { readonly kind: "approved" }
  | { readonly kind: "denied"; readonly reason: string | null }
  // handed to the cell; met again by a later step, it was cut mid-run and runs again
  | { readonly kind: "running" }
  | { readonly kind: "answered"; readonly answer: ToolAnswer };

export type ToolCallEvent =
  | { readonly kind: "decide"; readonly approved: boolean; readonly reason: string | null }
  | { readonly kind: "run" }
  | { readonly kind: "result"; readonly answer: ToolAnswer }
  | { readonly kind: "stop" };

type ToolCallRow = Pick<
  typeof toolCalls.$inferSelect,
  "decision" | "isError" | "reason" | "result" | "status"
>;

export const toolCallOf = (row: ToolCallRow): ToolCall => {
  switch (row.status) {
    case "pending": {
      return { kind: "asked" };
    }
    case "awaiting_approval": {
      if (row.decision === "approved") {
        return { kind: "approved" };
      }
      return row.decision === "denied"
        ? { kind: "denied", reason: row.reason }
        : { kind: "awaiting" };
    }
    case "running": {
      return { kind: "running" };
    }
    case "done": {
      return {
        answer: { content: row.result ?? "", isError: row.isError === 1 },
        kind: "answered",
      };
    }
    // no default
  }
};

const declined = (reason: string | null): ToolCall => ({
  answer: { content: reason === null ? DECLINED : `${DECLINED} ${reason}`, isError: true },
  kind: "answered",
});

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
      return event.approved ? { kind: "approved" } : { kind: "denied", reason: event.reason };
    }
    case "run": {
      if (call.kind === "denied") {
        return declined(call.reason);
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
      return call.kind === "denied" ? declined(call.reason) : STOPPED_CALL;
    }
    // no default
  }
};
