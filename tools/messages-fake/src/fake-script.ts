// What the fake answers in place of a model: the directive lines of the person's latest message,
// one step a model call, the step found by counting the replies since that message. Every other
// line is the person's words, which steer nothing.
//
//   call <tool> <json object>   a reply that thinks, then calls that tool with that input
//   spend <cents>               a reply whose output costs that many cents at the request model's
//                               list price, cut at max_tokens when that is less
//   long <chars>                a reply of that much text, streamed slowly
//   refuse <category>           a refusal no fallback takes up
//   fallback                    a refusal the request's `fallbacks` take up
//   stall [thinking]            the next step's reply, the first time a body asks for it, streams
//                               to the middle of its last block (of its last thinking block with
//                               `thinking`) and holds until the client goes; asked again, it
//                               answers whole
//   fail <status> <times>       each body is answered that status that many times before it is
//                               answered at all
//   compact                     the next step's reply opens with a compaction block, as the API's
//                               threshold compaction would, when the request asks for compaction
//
// A `call` goes on to the next step; any other reply ends the turn, and with no step left the
// reply ends it naming the tools it called. `stall` and `compact` take no step of their own: each
// marks the step after it, or the closing reply when no step follows.

import { z } from "zod";

const REFUSAL_CATEGORIES = [
  "cyber",
  "bio",
  "frontier_llm",
  "reasoning_extraction",
  "general_harms",
] as const;

export type RefusalCategory = (typeof REFUSAL_CATEGORIES)[number];

const inputSchema = z.record(z.string(), z.json());

type FakeStep =
  | { readonly kind: "call"; readonly tool: string; readonly input: z.infer<typeof inputSchema> }
  | { readonly kind: "spend"; readonly cents: number }
  | { readonly kind: "long"; readonly chars: number }
  | { readonly kind: "refuse"; readonly category: RefusalCategory }
  | { readonly kind: "fallback" };

export type StallAt = "thinking" | "last";

export interface ScriptedStep {
  readonly step: FakeStep | null;
  readonly stall: StallAt | null;
  readonly compact: boolean;
}

export interface FakeScript {
  // each step, the stall that holds its reply when one does; a closing reply is the step past them
  readonly steps: readonly ScriptedStep[];
  // the stall that holds the closing reply, the one after every step, and whether it compacts
  readonly closingStall: StallAt | null;
  readonly closingCompact: boolean;
  readonly fail: { readonly status: number; readonly times: number } | null;
}

const CALL = /^call\s+(?<tool>[a-z][a-z0-9_]*)\s+(?<input>\{.*\})$/u;
const SPEND = /^spend\s+(?<cents>[1-9]\d{0,5})$/u;
const LONG = /^long\s+(?<chars>[1-9]\d{0,6})$/u;
const REFUSE = /^refuse\s+(?<category>[a-z_]+)$/u;
const STALL = /^stall(?:\s+(?<at>thinking))?$/u;
const FAIL = /^fail\s+(?<status>[45]\d\d)\s+(?<times>[1-9]\d{0,2})$/u;
const COMPACT = "compact";

const parsedInput = (text: string) => {
  try {
    const parsed = inputSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const categoryOf = (text: string): RefusalCategory | null =>
  REFUSAL_CATEGORIES.find((category) => category === text) ?? null;

const stepOf = (line: string): FakeStep | null => {
  const call = CALL.exec(line)?.groups;
  if (call?.tool !== undefined && call.input !== undefined) {
    const input = parsedInput(call.input);
    return input === null ? null : { input, kind: "call", tool: call.tool };
  }
  const cents = SPEND.exec(line)?.groups?.cents;
  if (cents !== undefined) {
    return { cents: Number(cents), kind: "spend" };
  }
  const chars = LONG.exec(line)?.groups?.chars;
  if (chars !== undefined) {
    return { chars: Number(chars), kind: "long" };
  }
  const category = categoryOf(REFUSE.exec(line)?.groups?.category ?? "");
  if (category !== null) {
    return { category, kind: "refuse" };
  }
  return line === "fallback" ? { kind: "fallback" } : null;
};

// the script a message's text asks for, in its order
export const scriptOf = (text: string): FakeScript => {
  const steps: ScriptedStep[] = [];
  let stall: StallAt | null = null;
  let compact = false;
  let fail: FakeScript["fail"] = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === COMPACT) {
      compact = true;
      continue;
    }
    const stallMatch = STALL.exec(line);
    if (stallMatch !== null) {
      stall = stallMatch.groups?.at === "thinking" ? "thinking" : "last";
      continue;
    }
    const failed = FAIL.exec(line)?.groups;
    if (failed?.status !== undefined && failed.times !== undefined) {
      fail = { status: Number(failed.status), times: Number(failed.times) };
      continue;
    }
    const step = stepOf(line);
    if (step !== null) {
      steps.push({ compact, stall, step });
      stall = null;
      compact = false;
    }
  }
  return { closingCompact: compact, closingStall: stall, fail, steps };
};

// the step a request asks for: the one after the replies since the person's message, or the
// closing reply once none is left
export const stepAt = (script: FakeScript, replies: number): ScriptedStep =>
  script.steps[replies] ?? {
    compact: script.closingCompact,
    stall: script.closingStall,
    step: null,
  };
