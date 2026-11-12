// The scripted Messages API driven by the real SDK, as a conversation's object drives it: each
// directive a reply, every usage field on the stream, a 400 for each request shape Claude Sonnet 5.5
// refuses, a replayed thinking block bound to everything before it but a leading run of thinking,
// and one that fails dropped and counted under `drop_block` instead; progress notes shown under
// `display: "updates"`; and a compaction the conversation is read from, and bound from, after it,
// but one that wrote no summary, which compacts nothing.

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
const COMPACT_BETA = "compact-2026-01-12";
const DISPLAY_BETA = "thinking-display-updates-2026-08-18";

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

const GATEWAY_HEADERS = {
  "cf-aig-authorization": "Bearer test",
  "cf-aig-metadata": JSON.stringify({ account: "account-1" }),
};

const clientOf = (fake: MessagesFake): Anthropic =>
  new Anthropic({
    apiKey: null,
    authToken: null,
    baseURL: "http://fake.test",
    defaultHeaders: { Authorization: null, ...GATEWAY_HEADERS },
    fetch: fake.fetch,
    maxRetries: 0,
  });

type Body = Omit<MessageCreateParamsBase, "stream"> & { readonly betas?: string[] };

const bodyOf = (messages: BetaMessageParam[], extra: Partial<Body> = {}): Body => ({
  betas: BETAS,
  max_tokens: 4096,
  messages,
  model: "claude-sonnet-5-5",
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

// what a request adds to ask for threshold compaction, at the least input the API takes
const COMPACTING: Partial<Body> = {
  betas: [...BETAS, COMPACT_BETA],
  context_management: {
    edits: [{ trigger: { type: "input_tokens", value: 50_000 }, type: "compact_20260112" }],
  },
};

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

// a reply's blocks as the next request carries them: as returned
const replayedBlocks = (reply: BetaMessage): BetaContentBlockParam[] =>
  reply.content.flatMap((block): BetaContentBlockParam[] => {
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
      case "compaction": {
        return [
          {
            content: block.content,
            encrypted_content: block.encrypted_content,
            type: "compaction",
          },
        ];
      }
      default: {
        return [];
      }
    }
  });

const replayed = (reply: BetaMessage): BetaMessageParam => ({
  content: replayedBlocks(reply),
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
const SEARCH = 'call search_library {"query":"Paris"}';

// a reply as the next request carries it, its thinking blocks at `positions` left out
const without = (reply: BetaMessage, positions: readonly number[]): BetaMessageParam => ({
  content: replayedBlocks(reply).filter((_, at) => !positions.includes(at)),
  role: "assistant",
});

const thinkingOf = (reply: BetaMessage): string[] =>
  reply.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : []));

describe("the scripted Messages API", () => {
  it("thinks, calls the tool a step names, then closes naming it, the second request verifying the first's thinking", async () => {
    const fake = messagesFake();
    const opening = person(CALL);
    const first = await send(fake, bodyOf([opening]));
    expect(first.stop_reason).toBe("tool_use");
    expect(first.content.map((block) => block.type)).toStrictEqual([
      "thinking",
      "thinking",
      "tool_use",
    ]);
    expect(first.input_transformations).toStrictEqual([]);
    const second = await send(fake, bodyOf([opening, replayed(first), resultsOf(first)]));
    expect(second.stop_reason).toBe("end_turn");
    expect(second.content.at(-1)).toMatchObject({ text: "Done: create_note.", type: "text" });
    expect(second.input_transformations).toStrictEqual([]);
    expect(fake.stats()).toStrictEqual({ drops: 0, held: 0, requests: 2 });
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

  it("refuses with its category, and a fallback takes up a refusal the request names fallbacks for", async () => {
    const fake = messagesFake();
    const refused = await send(fake, bodyOf([person("refuse cyber")]));
    expect(refused.stop_reason).toBe("refusal");
    expect(refused.stop_details?.category).toBe("cyber");
    const rescued = await send(fake, bodyOf([person("fallback")], { fallbacks: "default" }));
    expect(rescued.stop_reason).toBe("end_turn");
    expect(rescued.content[0]).toMatchObject({
      to: { model: "claude-sonnet-5" },
      type: "fallback",
    });
    expect(rescued.usage.iterations?.map((entry) => entry.type)).toStrictEqual([
      "message",
      "fallback_message",
    ]);
  });

  it("fails a body the times its script names, then answers it", async () => {
    const fake = messagesFake();
    const body = bodyOf([person("fail 529 2\nHello.")]);
    await expect(refusalOf(fake, body)).resolves.toMatchObject({ status: 529 });
    await expect(refusalOf(fake, body)).resolves.toMatchObject({ status: 529 });
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
    await expect(reading).rejects.toThrow("Request was aborted.");
    expect(seen).toContain("content_block_start");
    expect(seen).not.toContain("message_stop");
    expect(fake.stats().held).toBe(1);
    const whole = await send(fake, body);
    expect(whole.stop_reason).toBe("tool_use");
    expect(fake.stats().held).toBe(1);
  });

  describe("refuses as Claude Sonnet 5.5 does", () => {
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
      [
        "a compaction trigger under 50,000 input tokens",
        bodyOf([person("Go.")], {
          ...COMPACTING,
          context_management: {
            edits: [{ trigger: { type: "input_tokens", value: 49_999 }, type: "compact_20260112" }],
          },
        }),
        /trigger\.value: must be at least 50000/u,
      ],
    ];

    it.for(cases)("%s", async ([, body, message]) => {
      const refusal = await refusalOf(fake, body);
      expect(refusal.status).toBe(400);
      expect(refusal.message).toMatch(message);
    });

    it("a sampling parameter", async () => {
      const response = await fake.fetch("http://fake.test/v1/messages", {
        body: JSON.stringify({ ...bodyOf([person("Go.")]), stream: true, temperature: 0.5 }),
        headers: { "anthropic-beta": BETAS.join(","), ...GATEWAY_HEADERS },
        method: "POST",
      });
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toMatch(
        /temperature: Extra inputs are not permitted/u,
      );
    });

    it("a message field but its role and content", async () => {
      const response = await fake.fetch(
        new Request("http://fake.test/v1/messages", {
          body: JSON.stringify({
            max_tokens: 10,
            messages: [{ content: "Go.", id: "m1", role: "user" }],
            model: "claude-sonnet-5-5",
            stream: true,
          }),
          headers: GATEWAY_HEADERS,
          method: "POST",
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toMatch(
        /messages\.0\.id: Extra inputs are not permitted/u,
      );
    });

    it.for([
      ["no metadata", null],
      ["metadata that is not JSON", "account-1"],
      ["metadata naming no account", JSON.stringify({ thread: "t1" })],
      [
        "metadata of more than five entries",
        JSON.stringify({ a: 1, account: "a", b: 2, c: 3, d: 4, e: 5 }),
      ],
    ] as const)(
      "a request with %s, as the gateway's spend limit could not split",
      async ([, metadata]) => {
        const headers = new Headers({
          "anthropic-beta": BETAS.join(","),
          "cf-aig-authorization": "Bearer test",
        });
        if (metadata !== null) {
          headers.set("cf-aig-metadata", metadata);
        }
        const response = await fake.fetch("http://fake.test/v1/messages", {
          body: JSON.stringify({ ...bodyOf([person("Go.")]), stream: true }),
          headers,
          method: "POST",
        });
        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toMatch(/names no account in cf-aig-metadata/u);
      },
    );
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
      expect(dropped.input_transformations).toStrictEqual(
        [0, 1].map((at) => ({
          path: `messages.1.content.${String(at)}`,
          reason: "prefix_binding_mismatch",
          type: "thinking_dropped",
        })),
      );
      expect(fake.stats().drops).toBe(2);
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
      expect(third.input_transformations).toStrictEqual([]);
      expect(fake.stats().drops).toBe(0);
    });
  });

  describe("shows what a thinking block holds as the request's display asks", () => {
    it("under updates, each progress note before its tool call, the reasoning hidden", async () => {
      const fake = messagesFake();
      const updates = bodyOf([person(CALL)], {
        betas: [...BETAS, DISPLAY_BETA],
        thinking: {
          block_binding: { prefix_mismatch_behavior: "drop_block" },
          display: "updates",
          type: "adaptive",
        },
      });
      const first = await send(fake, updates);
      expect(thinkingOf(first)).toStrictEqual(["", "Calling create_note now."]);
      expect(first.content.at(-1)?.type).toBe("tool_use");
      // replayed as returned, the notes verify like any thinking block
      const second = await send(fake, {
        ...updates,
        messages: [person(CALL), replayed(first), resultsOf(first)],
      });
      expect(thinkingOf(second)).toStrictEqual([""]);
      expect(second.input_transformations).toStrictEqual([]);
      expect(fake.stats().drops).toBe(0);
    });

    it("under summarized, every block's words, and under the default, none", async () => {
      const fake = messagesFake();
      const summarized = await send(
        fake,
        bodyOf([person(CALL)], {
          thinking: { display: "summarized", type: "adaptive" },
        }),
      );
      expect(thinkingOf(summarized)).toStrictEqual([
        "Call create_note as the person asked.",
        "Calling create_note now.",
      ]);
      const omitted = await send(fake, bodyOf([person(CALL)]));
      expect(thinkingOf(omitted)).toStrictEqual(["", ""]);
    });

    it("refuses updates without their beta", async () => {
      const refusal = await refusalOf(
        messagesFake(),
        bodyOf([person(CALL)], { thinking: { display: "updates", type: "adaptive" } }),
      );
      expect(refusal).toMatchObject({ status: 400 });
      expect(refusal.message).toMatch(/display/u);
    });
  });

  describe("compacts at a step its script marks, when the request asks", () => {
    const opening = person(`compact\n${CALL}\n${SEARCH}`);

    it("opens the reply with a compaction block, its sampling an iteration of its own", async () => {
      const fake = messagesFake();
      const first = await send(fake, bodyOf([opening], COMPACTING));
      expect(first.content.map((block) => block.type)).toStrictEqual([
        "compaction",
        "thinking",
        "thinking",
        "tool_use",
      ]);
      expect(first.content[0]).toMatchObject({ content: expect.any(String), type: "compaction" });
      const iterations = first.usage.iterations ?? [];
      expect(iterations.map((entry) => entry.type)).toStrictEqual(["compaction", "message"]);
      // the top level is every iteration's but the compaction's
      const [compaction, answered] = iterations;
      expect(first.usage.input_tokens).toBe(answered?.input_tokens);
      expect(first.usage.output_tokens).toBe(answered?.output_tokens);
      expect(compaction?.input_tokens).toBeGreaterThan(0);
      // a request that does not ask compacts nothing, and reports no iterations
      const plain = await send(fake, bodyOf([opening]));
      expect(plain.content.map((block) => block.type)).toStrictEqual([
        "thinking",
        "thinking",
        "tool_use",
      ]);
      expect(plain.usage.iterations).toBeNull();
    });

    it("reads the conversation from the compaction block on, whatever came before it", async () => {
      const fake = messagesFake();
      const first = await send(fake, bodyOf([opening], COMPACTING));
      // sent from the compaction block on: the person's script is what the compaction kept
      const fromBlock = [replayed(first), resultsOf(first)];
      const second = await send(fake, bodyOf(fromBlock, COMPACTING));
      expect(second.content.at(-1)).toMatchObject({ name: "search_library", type: "tool_use" });
      expect(second.usage.iterations?.map((entry) => entry.type)).toStrictEqual(["message"]);
      // sent whole, an edit before the block changes nothing: the API ignores what it summarized
      const whole = await send(
        fake,
        bodyOf([person(`compact\n${CALL}\n${SEARCH}\nAn edit.`), ...fromBlock], COMPACTING),
      );
      expect(whole.content.at(-1)).toMatchObject({ name: "search_library", type: "tool_use" });
      expect(whole.input_transformations).toStrictEqual([]);
      const third = await send(
        fake,
        bodyOf([...fromBlock, replayed(second), resultsOf(second)], COMPACTING),
      );
      expect(third.content.at(-1)).toMatchObject({
        text: "Done: create_note, search_library.",
        type: "text",
      });
      expect(third.input_transformations).toStrictEqual([]);
      expect(fake.stats().drops).toBe(0);
    });

    it("lets the leading run after the block go, and still fails a thinking block removed from the middle", async () => {
      const fake = messagesFake();
      const first = await send(fake, bodyOf([opening], COMPACTING));
      const second = await send(fake, bodyOf([replayed(first), resultsOf(first)], COMPACTING));
      const after = [replayed(second), resultsOf(second)];
      // the first reply's two thinking blocks, the first and second after the compaction block
      const leading = await send(
        fake,
        bodyOf([without(first, [1, 2]), resultsOf(first), ...after], COMPACTING),
      );
      expect(leading.input_transformations).toStrictEqual([]);
      expect(fake.stats().drops).toBe(0);
      // the progress note alone, with the reasoning before it kept: the next reply's chain breaks
      const middle = [without(first, [2]), resultsOf(first), ...after];
      const strict = await refusalOf(
        fake,
        bodyOf(middle, {
          ...COMPACTING,
          thinking: { block_binding: { prefix_mismatch_behavior: "error" }, type: "adaptive" },
        }),
      );
      expect(strict).toMatchObject({ status: 400 });
      expect(strict.message).toMatch(
        /messages\.2\.content\.0: .*bound to a different conversation/u,
      );
      const dropped = await send(fake, bodyOf(middle, COMPACTING));
      expect(dropped.input_transformations?.map((entry) => entry.path)).toStrictEqual([
        "messages.2.content.0",
        "messages.2.content.1",
      ]);
      expect(fake.stats().drops).toBe(2);
    });

    it("reads past a compaction block that wrote no summary, which compacts nothing", async () => {
      const fake = messagesFake();
      const first = await send(fake, bodyOf([person(CALL)], COMPACTING));
      // a closing reply whose compaction wrote no summary, as one may when tools are defined
      const unsummarized: BetaMessageParam = {
        content: [
          { content: null, type: "compaction" },
          { text: "Done: create_note.", type: "text" },
        ],
        role: "assistant",
      };
      const kept = [replayed(first), resultsOf(first), unsummarized, person("And now?")];
      const answered = await send(fake, bodyOf([person(CALL), ...kept], COMPACTING));
      expect(answered.input_transformations).toStrictEqual([]);
      // the thinking before the block is still bound from the conversation's start, so an edit
      // there fails it
      const edited = await send(fake, bodyOf([person(`${CALL}\nAn edit.`), ...kept], COMPACTING));
      expect(edited.input_transformations?.map((entry) => entry.path)).toStrictEqual([
        "messages.1.content.0",
        "messages.1.content.1",
      ]);
      expect(fake.stats().drops).toBe(2);
    });

    it("refuses compaction without its beta", async () => {
      const refusal = await refusalOf(
        messagesFake(),
        bodyOf([opening], { context_management: COMPACTING.context_management }),
      );
      expect(refusal).toMatchObject({ status: 400 });
      expect(refusal.message).toMatch(/context_management/u);
    });
  });

  it("answers its counters, and nothing it does not serve", async () => {
    const fake = messagesFake();
    await send(fake, bodyOf([person("Hello.")]));
    const stats = await fake.fetch(new Request("http://fake.test/__fake/stats"));
    await expect(stats.json()).resolves.toStrictEqual({ drops: 0, held: 0, requests: 1 });
    const unserved = await fake.fetch(new Request("http://fake.test/v1/models"));
    expect(unserved.status).toBe(404);
    const gateway = await fake.fetch(
      new Request("http://fake.test/v1/account/gateway/anthropic/v1/messages", { method: "POST" }),
    );
    expect(gateway.status).toBe(404);
  });
});
