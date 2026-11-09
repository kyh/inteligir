// A conversation's request bodies as the thread sent them, read for what the API checks a replayed
// thinking block against: the system, the tools and every message before it. A body is read by
// JSON.parse, which keeps every key where it was sent, and narrowed, never parsed into a copy, so
// writing a part out again gives the bytes the client sent for it; its breakpoints are taken out
// where they stood and nothing else is touched, since moving one is no edit.

import { expect } from "vitest";
import { z } from "zod";

const sentBlocksSchema = z.array(z.record(z.string(), z.unknown()));

const sentSchema = z.looseObject({
  messages: z.array(z.looseObject({ content: sentBlocksSchema, role: z.string() })),
  system: sentBlocksSchema,
  tools: sentBlocksSchema,
});

export type SentBody = z.infer<typeof sentSchema>;

// a body as it was sent, its breakpoints taken out
export const unmarkedOf = (text: string): SentBody => {
  const value: unknown = JSON.parse(text);
  if (!sentSchema.validate(value)) {
    throw new Error("a body the thread did not send");
  }
  for (const block of [
    ...value.system,
    ...value.tools,
    ...value.messages.flatMap((message) => message.content),
  ]) {
    Reflect.deleteProperty(block, "cache_control");
  }
  return value;
};

// each body after the first sends the system, the tools and every message the one before it sent
// byte for byte, breakpoints aside, and more messages after them
export const expectSharedPrefixes = (bodies: readonly string[]): void => {
  const unmarked = bodies.map(unmarkedOf);
  for (const [index, body] of unmarked.slice(1).entries()) {
    const before = unmarked[index];
    if (before === undefined) {
      throw new Error("a request with none before it");
    }
    const label = `body ${String(index + 1)}`;
    expect(JSON.stringify(body.system), label).toBe(JSON.stringify(before.system));
    expect(JSON.stringify(body.tools), label).toBe(JSON.stringify(before.tools));
    expect(body.messages.length, label).toBeGreaterThan(before.messages.length);
    for (const [at, message] of before.messages.entries()) {
      expect(JSON.stringify(body.messages[at]), `${label} message ${String(at)}`).toBe(
        JSON.stringify(message),
      );
    }
  }
};

// the type of every block of every message a body sent
export const blockTypesOf = (body: SentBody): string[][] =>
  body.messages.map((message) =>
    message.content.map((block) => z.object({ type: z.string() }).parse(block).type),
  );
