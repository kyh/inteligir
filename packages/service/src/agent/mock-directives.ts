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

const callOf = (line: string) => {
  const groups = CALL.exec(line)?.groups;

  if (groups?.tool === undefined || groups.input === undefined) {
    return null;
  }

  try {
    const input = callInputSchema.safeParse(JSON.parse(groups.input));

    return (input.success ? { input: input.data, tool: groups.tool } : null) satisfies {
      tool: string;
      input: CallInput;
    } | null;
  } catch {
    return null;
  }
};

const linesOf = (message: string) => message.split(/\r?\n/u).map((line) => line.trim());

export const mockUsageOf = (message: string) => {
  const count = linesOf(message)
    .map((line) => TOKENS.exec(line)?.groups?.count)
    .find((value) => value !== undefined);

  return { inputTokens: 0, outputTokens: count === undefined ? 0 : Number(count) };
};

export interface MockRead {
  readonly screen: string | null;
  readonly rules: string | null;
}

export const mockStep = (message: string, step: number, { rules, screen }: MockRead) => {
  const lines = linesOf(message);
  const calls = lines.flatMap((line) => callOf(line) ?? []);
  const next = calls[step];

  if (next !== undefined) {
    return { input: next.input, kind: "call", tool: next.tool } satisfies MockStep;
  }

  if (lines.some((line) => CONTEXT.test(line))) {
    return {
      afterMs: 0,
      kind: "reply",
      text: `Sent from: ${screen ?? "nowhere"}`,
    } satisfies MockStep;
  }

  if (lines.some((line) => RULES.test(line))) {
    return {
      afterMs: 0,
      kind: "reply",
      text: `Filing rules: ${rules ?? "none"}`,
    } satisfies MockStep;
  }

  const chars = lines
    .map((line) => LONG.exec(line)?.groups?.chars)
    .find((value) => value !== undefined);

  if (chars !== undefined) {
    return {
      afterMs: Number(chars),
      kind: "reply",
      text: "x".repeat(Number(chars)),
    } satisfies MockStep;
  }

  if (calls.length > 0) {
    return {
      afterMs: 0,
      kind: "reply",
      text: `Done: ${calls.map(({ tool }) => tool).join(", ")}`,
    } satisfies MockStep;
  }

  return { afterMs: 0, kind: "reply", text: `You said: ${message}` } satisfies MockStep;
};
