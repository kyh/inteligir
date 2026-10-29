// What the fake's agent does with a message, in place of a model: each line of the message that
// reads as one of the directives below is one step of its turn, in order, and the turn ends with
// a reply naming what it did. Nothing else in the message steers it, so the view context and the
// person's words ride along as a real session's would, read by nobody but the suites that look.
//
//   call <tool> <json object>   calls one of the session's tools with that input
//   spend <cents>               one model request that costs that many cents of list price
//   stall                       keeps working until it is interrupted
//
// Every step is one model request; a `call` that waits on the person's approval waits there.

import { z } from "zod";

// a tool's input, a JSON object
const inputSchema = z.record(z.string(), z.json());
export type ToolInput = z.infer<typeof inputSchema>;

export type FakeStep =
  | { readonly kind: "call"; readonly tool: string; readonly input: ToolInput }
  | { readonly kind: "spend"; readonly cents: number }
  | { readonly kind: "stall" };

const CALL = /^call\s+(?<tool>[a-z][a-z0-9_]*)\s+(?<input>\{.*\})\s*$/u;
const SPEND = /^spend\s+(?<cents>[1-9]\d{0,5})\s*$/u;
const STALL = /^stall\s*$/u;

const parsedInput = (text: string): ToolInput | null => {
  try {
    const parsed = inputSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const stepOf = (line: string): FakeStep | null => {
  const call = CALL.exec(line)?.groups;
  if (call?.["tool"] !== undefined && call["input"] !== undefined) {
    const input = parsedInput(call["input"]);
    return input === null ? null : { input, kind: "call", tool: call["tool"] };
  }
  const cents = SPEND.exec(line)?.groups?.["cents"];
  if (cents !== undefined) {
    return { cents: Number(cents), kind: "spend" };
  }
  return STALL.test(line) ? { kind: "stall" } : null;
};

// the steps a message's text asks for, in its order
export const stepsOf = (text: string): FakeStep[] =>
  text.split(/\r?\n/u).flatMap((line) => stepOf(line.trim()) ?? []);
