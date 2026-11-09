// What the cell is told a call's prompt holds at most (seeded, so a failure replays): text in any
// script counted at no fewer tokens than Claude may bill it, as it stands and as a request's JSON
// carries it; and after a call under the same definition, that call's billed prompt and reply and
// what was added since, a reply's thinking left out, unless the whole request counts fewer.

import { mulberry32 } from "@repo/contract/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import { textOf } from "../test-support/scripts-text";
import { AGENT_MAX_TOKENS } from "./library-agent";
import { agentRequest, callEstimateOf, deployedDefinition, tokensAtMost } from "./thread-request";

describe("a text's tokens at most", () => {
  it.each([
    ["nothing", "", 0],
    // two words and the space between them: ten letters at 0.4 and half a token
    ["English", "the library", 5],
    // a word past sixteen letters is counted as an id is
    ["a long word", "internationalization", 20],
    ["a number", "1730000000000", 13],
    // a chain holding a digit, each of its parts and joining marks a token, a group of letters
    // alone among them included
    ["a uuid", "0193b5e2-7c4a-abcd-9f21-3a4b5c6d7e8f", 36],
    // three UTF-8 bytes each
    ["CJK", "我们的图书馆", 18],
    // four UTF-8 bytes
    ["an emoji", "🧑", 4],
    // a word of three letters, then two bytes
    ["an accent", "café", 4],
  ])("counts %s", (_kind, text, tokens) => {
    expect(tokensAtMost(text)).toBe(tokens);
  });

  // two thousand texts of up to two thousand tokens each
  it(
    "counts no fewer tokens than Claude may bill text in any script (seeded)",
    { timeout: 30_000 },
    () => {
      const rand = mulberry32(0x70_6b);
      for (let run = 0; run < 2000; run += 1) {
        const { text, tokens } = textOf(rand, 1 + Math.floor(rand() * 2000));
        expect(tokensAtMost(text)).toBeGreaterThanOrEqual(tokens);
        expect(tokensAtMost(JSON.stringify(text))).toBeGreaterThanOrEqual(tokens);
      }
    },
  );
});

const definition = deployedDefinition();

const message = (text: string) => ({
  content: [{ text, type: "text" as const }],
  role: "user" as const,
});

describe("a call's estimate", () => {
  it("counts the whole request when no call went before it under its definition", () => {
    const request = agentRequest(definition, [message("Tidy my library.")], AGENT_MAX_TOKENS);
    expect(callEstimateOf(definition, request, null, [])).toStrictEqual({
      frozenTokens:
        tokensAtMost(JSON.stringify(definition.system)) +
        tokensAtMost(JSON.stringify(definition.tools)),
      previous: null,
      promptTokens: tokensAtMost(JSON.stringify(request)),
    });
  });

  it("counts from the last call's billed prompt and reply, and what was added since", () => {
    const added = message("今日保存した記事を要約して");
    const request = agentRequest(
      definition,
      [message("x".repeat(400_000)), added],
      AGENT_MAX_TOKENS,
    );
    const anchor = { endedAt: 1000, promptTokens: 40_000, replyTokens: 1200 };
    expect(callEstimateOf(definition, request, anchor, [added])).toMatchObject({
      previous: { endedAt: 1000, promptTokens: 40_000 },
      promptTokens: 40_000 + 1200 + tokensAtMost(JSON.stringify([added])),
    });
    // the reply among what was added, its thinking left out: the reply's output holds it
    const reply = {
      content: [
        { signature: "s".repeat(4000), thinking: "", type: "thinking" as const },
        { text: "Filed.", type: "text" as const },
      ],
      role: "assistant" as const,
    };
    const shown = { content: [{ text: "Filed.", type: "text" as const }], role: "assistant" };
    const after = agentRequest(
      definition,
      [message("x".repeat(400_000)), reply, added],
      AGENT_MAX_TOKENS,
    );
    expect(callEstimateOf(definition, after, anchor, [reply, added]).promptTokens).toBe(
      40_000 + 1200 + tokensAtMost(JSON.stringify([shown, added])),
    );
    // the whole request, when it counts fewer
    const short = agentRequest(definition, [added], AGENT_MAX_TOKENS);
    expect(callEstimateOf(definition, short, anchor, [added]).promptTokens).toBe(
      tokensAtMost(JSON.stringify(short)),
    );
  });
});
