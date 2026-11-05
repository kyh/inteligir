// The scripted Messages API driven by the real SDK, as a conversation's object drives it: each
// directive a reply, every usage field on the stream, a 400 for each request shape Claude Opus 5.5
// refuses, a replayed thinking block bound to everything before it but a leading run of thinking,
// and one that fails dropped and counted under `drop_block` instead.

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  MessageCreateParamsBase,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";

import { messagesFake } from "./messages-fake.ts";
import type { MessagesFake } from "./messages-fake.ts";

const BETAS = ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"];

const TOOLS = [
  {
    input_schema: { properties: { markdown: { type: "string" } }, type: "object" as const },
    name: "create_note",
  },
  {
    input_schema: { properties: { query: { type: "string" } }, type: "object" as const },
    name: "search_library",
  },
];

const clientOf = (fake: MessagesFake): Anthropic =>
  new Anthropic({
    apiKey: null,
    authToken: null,
    baseURL: "http://fake.test",
    defaultHeaders: { Authorization: null, "cf-aig-authorization": "Bearer test" },
    fetch: fake.fetch,
    maxRetries: 0,
  });

type Body = Omit<MessageCreateParamsBase, "stream"> & { readonly betas?: string[] };

const bodyOf = (messages: BetaMessageParam[], extra: Partial<Body> = {}): Body => ({
  betas: BETAS,
  max_tokens: 4096,
  messages,
  model: "claude-opus-5-5",
  output_config: { effort: "medium" },
  system: [
    {
      cache_control: { ttl: "1h", type: "ephemeral" },
      text: "You are a fake's client.",
      type: "text",
    },
  ],
  thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" }, type: "adaptive" },
  tools: TOOLS,
  ...extra,
});

const send = async (fake: MessagesFake, body: Body): Promise<BetaMessage> =>
  await clientOf(fake).beta.messages.stream(body).finalMessage();

const refusalOf = async (
  fake: MessagesFake,
  body: Body,
): Promise<{ status: number; message: string }> => {
  try {
    await send(fake, body);
  } catch (error) {
    if (error instanceof APIError) {
      return { message: error.message, status: error.status ?? 0 };
    }
    throw error;
  }
  throw new Error("the fake answered a request it should refuse");
};

const person = (text: string): BetaMessageParam => ({
  content: [{ text, type: "text" }],
  role: "user",
});

// a reply as the next request carries it: its blocks as returned
const replayed = (reply: BetaMessage): BetaMessageParam => ({
  content: reply.content.flatMap((block): BetaContentBlockParam[] => {
    switch (block.type) {
      case "thinking": {
        return [{ signature: block.signature, thinking: block.thinking, type: "thinking" }];
      }
      case "text": {
        return [{ text: block.text, type: "text" }];
      }
      case "tool_use": {
        return [{ id: block.id, input: block.input, name: block.name, type: "tool_use" }];
      }
      default: {
        return [];
      }
    }
  }),
  role: "assistant",
});

const resultsOf = (reply: BetaMessage): BetaMessageParam => ({
  content: reply.content.flatMap((block): BetaContentBlockParam[] =>
    block.type === "tool_use"
      ? [{ content: "ok", tool_use_id: block.id, type: "tool_result" }]
      : [],
  ),
  role: "user",
});

const CALL = 'call create_note {"markdown":"Paris"}';

describe("the scripted Messages API", () => {
  it("thinks, calls the tool a step names, then closes naming it, the second request verifying the first's thinking", async () => {
    const fake = messagesFake();
    const opening = person(CALL);
    const first = await send(fake, bodyOf([opening]));
    expect(first.stop_reason).toBe("tool_use");
    expect(first.content.map((block) => block.type)).toEqual(["thinking", "tool_use"]);
    expect(first.input_transformations).toEqual([]);
    const second = await send(fake, bodyOf([opening, replayed(first), resultsOf(first)]));
    expect(second.stop_reason).toBe("end_turn");
    expect(second.content.at(-1)).toMatchObject({ text: "Done: create_note.", type: "text" });
    expect(second.input_transformations).toEqual([]);
    expect(fake.stats()).toEqual({ drops: 0, held: 0, requests: 2 });
  });

  it("reports every usage field, reading what comes before the last breakpoint and writing the block that carries it", async () => {
    const fake = messagesFake();
    const reply = await send(fake, bodyOf([person("Hello.")]));
    expect(reply.usage).toMatchObject({
      cache_creation: {
        ephemeral_1h_input_tokens: expect.any(Number),
        ephemeral_5m_input_tokens: 0,
      },
      cache_creation_input_tokens: expect.any(Number),
      cache_read_input_tokens: expect.any(Number),
      input_tokens: expect.any(Number),
      output_tokens: expect.any(Number),
    });
    expect(reply.usage.cache_read_input_tokens).toBeGreaterThan(0);
    expect(reply.usage.cache_creation?.ephemeral_1h_input_tokens).toBe(
      reply.usage.cache_creation_input_tokens,
    );
  });

  it("spends the cents a step names at the model's output price, cut at max_tokens", async () => {
    const fake = messagesFake();
    const whole = await send(fake, bodyOf([person("spend 2")]));
    // $20 a million output tokens: a cent is 500 tokens
    expect(whole.usage.output_tokens).toBe(1000);
    expect(whole.stop_reason).toBe("end_turn");
    const cut = await send(fake, bodyOf([person("spend 2")], { max_tokens: 300 }));
    expect(cut.usage.output_tokens).toBe(300);
    expect(cut.stop_reason).toBe("max_tokens");
  });

  it("refuses with its category, and a fallback takes up a refusal the request names fallbacks for", async () => {
    const fake = messagesFake();
    const refused = await send(fake, bodyOf([person("refuse cyber")]));
    expect(refused.stop_reason).toBe("refusal");
    expect(refused.stop_details?.category).toBe("cyber");
    const rescued = await send(fake, bodyOf([person("fallback")], { fallbacks: "default" }));
    expect(rescued.stop_reason).toBe("end_turn");
    expect(rescued.content[0]).toMatchObject({ to: { model: "claude-opus-5" }, type: "fallback" });
    expect(rescued.usage.iterations?.map((entry) => entry.type)).toEqual([
      "message",
      "fallback_message",
    ]);
  });

  it("fails a body the times its script names, then answers it", async () => {
    const fake = messagesFake();
    const body = bodyOf([person("fail 529 2\nHello.")]);
    expect(await refusalOf(fake, body)).toMatchObject({ status: 529 });
    expect(await refusalOf(fake, body)).toMatchObject({ status: 529 });
    const answered = await send(fake, body);
    expect(answered.stop_reason).toBe("end_turn");
  });

  it("holds a stalled reply open until the client goes, then answers the same body whole", async () => {
    const fake = messagesFake();
    const body = bodyOf([person(`stall\n${CALL}`)]);
    const controller = new AbortController();
    const stream = clientOf(fake).beta.messages.stream(body, { signal: controller.signal });
    const seen: string[] = [];
    const reading = (async () => {
      for await (const event of stream) {
        seen.push(event.type);
        if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          controller.abort();
        }
      }
    })();
    await expect(reading).rejects.toThrow();
    expect(seen).toContain("content_block_start");
    expect(seen).not.toContain("message_stop");
    expect(fake.stats().held).toBe(1);
    const whole = await send(fake, body);
    expect(whole.stop_reason).toBe("tool_use");
    expect(fake.stats().held).toBe(1);
  });

  describe("refuses as Claude Opus 5.5 does", () => {
    const fake = messagesFake();
    const cases: [string, Body, RegExp][] = [
      [
        "an assistant message last, a prefill",
        bodyOf([
          person("Go."),
          { content: [{ text: "Here is", type: "text" }], role: "assistant" },
        ]),
        /prefill/u,
      ],
      [
        "thinking that is not adaptive",
        bodyOf([person("Go.")], { thinking: { budget_tokens: 2048, type: "enabled" } }),
        /adaptive/u,
      ],
      [
        "a forced tool choice",
        bodyOf([person("Go.")], { tool_choice: { type: "any" } }),
        /tool_choice/u,
      ],
      [
        "a tool call with no result next",
        bodyOf([
          person("Go."),
          {
            content: [{ id: "toolu_1", input: {}, name: "create_note", type: "tool_use" }],
            role: "assistant",
          },
          person("And?"),
        ]),
        /tool_result/u,
      ],
      [
        "a system message that follows no user message",
        bodyOf([
          person("Go."),
          { content: [{ text: "Hi.", type: "text" }], role: "assistant" },
          { content: [{ text: "Rules.", type: "text" }], role: "system" },
        ]),
        /system message/u,
      ],
      [
        "a system message with a user message after it",
        bodyOf([
          person("Go."),
          { content: [{ text: "Rules.", type: "text" }], role: "system" },
          person("Again."),
        ]),
        /system message/u,
      ],
      [
        "more than four breakpoints",
        bodyOf([
          {
            content: ["a", "b", "c", "d"].map((text) => ({
              cache_control: { type: "ephemeral" as const },
              text,
              type: "text" as const,
            })),
            role: "user",
          },
        ]),
        /maximum of 4/u,
      ],
      [
        "a 1-hour breakpoint after a 5-minute one",
        bodyOf([person("Go.")], {
          system: [
            { cache_control: { ttl: "1h", type: "ephemeral" }, text: "System.", type: "text" },
          ],
          tools: TOOLS.map((tool) => ({
            ...tool,
            cache_control: { type: "ephemeral" as const },
          })),
        }),
        /1h/u,
      ],
      [
        "the binding control without its beta",
        bodyOf([person("Go.")], { betas: [] }),
        /block_binding/u,
      ],
    ];
    for (const [refused, body, message] of cases) {
      it(refused, async () => {
        const refusal = await refusalOf(fake, body);
        expect(refusal.status).toBe(400);
        expect(refusal.message).toMatch(message);
      });
    }

    it("a sampling parameter", async () => {
      const response = await fake.fetch("http://fake.test/v1/messages", {
        body: JSON.stringify({ ...bodyOf([person("Go.")]), stream: true, temperature: 0.5 }),
        headers: { "anthropic-beta": BETAS.join(","), "cf-aig-authorization": "Bearer test" },
        method: "POST",
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/temperature: Extra inputs are not permitted/u);
    });

    it("a message field but its role and content", async () => {
      const response = await fake.fetch(
        new Request("http://fake.test/v1/messages", {
          body: JSON.stringify({
            max_tokens: 10,
            messages: [{ content: "Go.", id: "m1", role: "user" }],
            model: "claude-opus-5-5",
            stream: true,
          }),
          headers: { "cf-aig-authorization": "Bearer test" },
          method: "POST",
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/messages\.0\.id: Extra inputs are not permitted/u);
    });
  });

  describe("binds a replayed thinking block to what came before it", () => {
    it("refuses an edit before it unless the request drops the block, which it counts", async () => {
      const fake = messagesFake();
      const first = await send(fake, bodyOf([person(CALL)]));
      const edited = [person(`${CALL}\nAn edit.`), replayed(first), resultsOf(first)];
      const strict = await refusalOf(
        fake,
        bodyOf(edited, {
          thinking: { block_binding: { prefix_mismatch_behavior: "error" }, type: "adaptive" },
        }),
      );
      expect(strict).toMatchObject({ status: 400 });
      expect(strict.message).toMatch(/bound to a different conversation/u);
      const dropped = await send(fake, bodyOf(edited));
      expect(dropped.input_transformations).toEqual([
        {
          path: "messages.1.content.0",
          reason: "prefix_binding_mismatch",
          type: "thinking_dropped",
        },
      ]);
      expect(fake.stats().drops).toBe(1);
    });

    it("accepts the history with a leading run of thinking left out and a breakpoint moved", async () => {
      const fake = messagesFake();
      const opening = person(CALL);
      const first = await send(fake, bodyOf([opening]));
      const second = await send(fake, bodyOf([opening, replayed(first), resultsOf(first)]));
      const toolCall = first.content.flatMap((block): BetaContentBlockParam[] =>
        block.type === "tool_use"
          ? [{ id: block.id, input: block.input, name: block.name, type: "tool_use" }]
          : [],
      );
      const third = await send(
        fake,
        bodyOf([
          opening,
          { content: toolCall, role: "assistant" },
          resultsOf(first),
          replayed(second),
          {
            content: [{ cache_control: { type: "ephemeral" }, text: "More.", type: "text" }],
            role: "user",
          },
        ]),
      );
      expect(third.input_transformations).toEqual([]);
      expect(fake.stats().drops).toBe(0);
    });
  });

  it("answers its counters, and nothing it does not serve", async () => {
    const fake = messagesFake();
    await send(fake, bodyOf([person("Hello.")]));
    const stats = await fake.fetch(new Request("http://fake.test/__fake/stats"));
    expect(await stats.json()).toEqual({ drops: 0, held: 0, requests: 1 });
    const unserved = await fake.fetch(new Request("http://fake.test/v1/models"));
    expect(unserved.status).toBe(404);
    const gateway = await send(fake, bodyOf([person("Hello.")]));
    expect(gateway.type).toBe("message");
  });
});
