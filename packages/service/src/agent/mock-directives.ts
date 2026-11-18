// The script eve's mock model plays on a local run (apps/web/agent/mock-model.ts), and the suites'
// fake platform with it: one directive per line of the person's latest message.
//   call <tool> <json object>   one step that calls that tool with that input
//   long <chars>                a reply of that much text, after that many milliseconds
//   tokens <count>              each model call reports that many output tokens, and none without
//   context                     a reply of the screen the message was sent from, as the model read it
//   rules                       a reply of the filing rules the model read after the agent's prompt
// A step is a tool result since that message; with no step left, the reply names what it called,
// and a message with no directive is said back.

import { z } from "zod";

const CALL = /^call\s+(?<tool>[a-z][a-z0-9_]*)\s+(?<input>\{.*\})$/u;
const LONG = /^long\s+(?<chars>[1-9]\d{0,6})$/u;
const TOKENS = /^tokens\s+(?<count>[1-9]\d{0,8})$/u;
const CONTEXT = /^context$/u;
const RULES = /^rules$/u;

const callInputSchema = z.record(z.string(), z.json());
type CallInput = z.infer<typeof callInputSchema>;

export type MockStep =
  | { readonly kind: "call"; readonly tool: string; readonly input: CallInput }
  | { readonly kind: "reply"; readonly text: string; readonly afterMs: number };

const callOf = (line: string): { tool: string; input: CallInput } | null => {
  const groups = CALL.exec(line)?.groups;
  if (groups?.tool === undefined || groups.input === undefined) {
    return null;
  }
  try {
    const input = callInputSchema.safeParse(JSON.parse(groups.input));
    return input.success ? { input: input.data, tool: groups.tool } : null;
  } catch {
    return null;
  }
};

const linesOf = (message: string): string[] => message.split(/\r?\n/u).map((line) => line.trim());

// what each model call reports it spent, which the day's dollars price
export const mockUsageOf = (message: string) => {
  const count = linesOf(message)
    .map((line) => TOKENS.exec(line)?.groups?.count)
    .find((value) => value !== undefined);
  return { inputTokens: 0, outputTokens: count === undefined ? 0 : Number(count) };
};

// what the model read beside the message, each null for none
export interface MockRead {
  // the client context the message was sent with
  readonly screen: string | null;
  // the person's filing rules, after the agent's prompt
  readonly rules: string | null;
}

// what the mock does at `step`, the tool results it read since the message
export const mockStep = (message: string, step: number, { rules, screen }: MockRead): MockStep => {
  const lines = linesOf(message);
  const calls = lines.flatMap((line) => callOf(line) ?? []);
  const next = calls[step];
  if (next !== undefined) {
    return { input: next.input, kind: "call", tool: next.tool };
  }
  if (lines.some((line) => CONTEXT.test(line))) {
    return { afterMs: 0, kind: "reply", text: `Sent from: ${screen ?? "nowhere"}` };
  }
  if (lines.some((line) => RULES.test(line))) {
    return { afterMs: 0, kind: "reply", text: `Filing rules: ${rules ?? "none"}` };
  }
  const chars = lines
    .map((line) => LONG.exec(line)?.groups?.chars)
    .find((value) => value !== undefined);
  if (chars !== undefined) {
    return { afterMs: Number(chars), kind: "reply", text: "x".repeat(Number(chars)) };
  }
  if (calls.length > 0) {
    return { afterMs: 0, kind: "reply", text: `Done: ${calls.map(({ tool }) => tool).join(", ")}` };
  }
  return { afterMs: 0, kind: "reply", text: `You said: ${message}` };
};
