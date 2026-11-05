// One request of a conversation, as the thread builds it from its frozen definition and its
// transcript, sent through the thread's own client to the scripted Messages API and its replies
// replayed as the thread keeps them: consecutive bodies share their system, their tools and every
// message they both carry, byte for byte as sent, key order included, but for the breakpoints, so
// each replayed thinking block meets the prefix it was signed against; three breakpoints, the
// hour's first; a message is its role and content alone, and the last is never the assistant's.

import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fakeStats, script } from "../test-support/agent-turns";
import { anthropicClient } from "./anthropic-client";
import {
  agentRequest,
  deployedDefinition,
  logDroppedThinking,
  replyBlocksOf,
  transcriptMessage,
} from "./thread-request";
import type { TranscriptMessage } from "./thread-request";

const blockSchema = z.record(z.string(), z.json());

const bodySchema = z.looseObject({
  messages: z.array(z.strictObject({ content: z.array(blockSchema), role: z.string() })),
  system: z.array(blockSchema),
  tools: z.array(blockSchema),
});

type Body = z.infer<typeof bodySchema>;

const sentBlocksSchema = z.array(z.record(z.string(), z.unknown()));
const sentSchema = z.looseObject({
  messages: z.array(z.looseObject({ content: sentBlocksSchema })),
  system: sentBlocksSchema,
  tools: sentBlocksSchema,
});

// a body as it was sent, each breakpoint taken out where it stood and nothing else touched: the
// text is read by JSON.parse, which keeps every key where it was sent, and narrowed, never parsed
// into a copy, so writing a part out again gives the bytes the client sent for it
const unmarkedOf = (text: string) => {
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

const markSchema = z.looseObject({
  cache_control: z.object({ ttl: z.enum(["5m", "1h"]).optional() }).optional(),
});

// every breakpoint in the order the API renders the request: tools, system, then the messages
const breakpointsOf = (body: Body): string[] =>
  [...body.tools, ...body.system, ...body.messages.flatMap((message) => message.content)].flatMap(
    (block) => {
      const mark = markSchema.parse(block).cache_control;
      return mark === undefined ? [] : [mark.ttl ?? "5m"];
    },
  );

// the thread's client to the scripted API, keeping the text of every body it sends
const recordingClient = () => {
  const sent: string[] = [];
  const client = anthropicClient(env, async (input, init) => {
    const request = new Request(input, init);
    sent.push(await request.clone().text());
    return await fetch(request);
  });
  if (client === null) {
    throw new Error("the suites bind the scripted API");
  }
  return { client, sent };
};

// a reply as the thread keeps it: its content as returned, stored as JSON and read back
const kept = (message: BetaMessage): TranscriptMessage => {
  if (replyBlocksOf(message.content) === null) {
    throw new Error("the fake's reply holds a block the thread cannot replay");
  }
  return transcriptMessage("assistant", JSON.stringify(message.content));
};

const person = (text: string): TranscriptMessage =>
  transcriptMessage("user", JSON.stringify([{ text, type: "text" }]));

describe("a conversation's request", () => {
  it("shares its system, tools and messages with the request before it, but for breakpoints", async () => {
    const { client, sent } = recordingClient();
    const definition = deployedDefinition();
    const send = async (transcript: readonly TranscriptMessage[]): Promise<BetaMessage> =>
      await client.beta.messages.stream(agentRequest(definition, transcript, 4096)).finalMessage();
    // a turn of two steps, a tool's result between them, then a turn of one with filing rules
    const transcript: TranscriptMessage[] = [
      person(script('call search_library {"query":"Paris"}')),
    ];
    const first = await send(transcript);
    expect(first.stop_reason).toBe("tool_use");
    const use = first.content.find((block) => block.type === "tool_use");
    transcript.push(
      kept(first),
      transcriptMessage(
        "user",
        JSON.stringify([
          { content: '{"hits":[]}', tool_use_id: use?.id ?? "", type: "tool_result" },
        ]),
      ),
    );
    const second = await send(transcript);
    const rules = transcriptMessage(
      "system",
      JSON.stringify([{ text: "File trips.", type: "text" }]),
    );
    transcript.push(kept(second), person(script("Thanks.")), rules);
    const third = await send(transcript);
    transcript.push(kept(third));
    expect(sent).toHaveLength(3);
    const bodies = sent.map((text) => bodySchema.parse(JSON.parse(text)));
    for (const [index, body] of bodies.entries()) {
      // the hour's breakpoints on the tools and the system, then the rolling one, never on thinking
      expect(breakpointsOf(body), `body ${String(index)}`).toEqual(["1h", "1h", "5m"]);
      // a message is its role and content alone (the strict parse), and never the assistant's last
      expect(body.messages.at(-1)?.role).not.toBe("assistant");
      for (const block of body.messages.flatMap((message) => message.content)) {
        if (block["type"] === "thinking" || block["type"] === "redacted_thinking") {
          expect(block).not.toHaveProperty("cache_control");
        }
      }
    }
    const unmarked = sent.map(unmarkedOf);
    for (const [index, body] of unmarked.slice(1).entries()) {
      const before = unmarked[index];
      if (before === undefined) {
        throw new Error("a request with none before it");
      }
      expect(JSON.stringify(body.system)).toBe(JSON.stringify(before.system));
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(before.tools));
      expect(body.messages.length).toBeGreaterThan(before.messages.length);
      for (const [at, message] of before.messages.entries()) {
        expect(
          JSON.stringify(body.messages[at]),
          `body ${String(index + 1)} message ${String(at)}`,
        ).toBe(JSON.stringify(message));
      }
    }
    // the breakpoint went on a copy: what the thread keeps carries none
    expect(JSON.stringify(transcript)).not.toContain("cache_control");
    const stats = await fakeStats();
    expect(stats.drops).toBe(0);
  });

  it("sends the definition's model and effort, adaptive thinking that drops what fails, and no sampling", () => {
    const body = agentRequest(deployedDefinition(), [person("Hello.")], 2048);
    expect(body).toMatchObject({
      betas: ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 2048,
      model: "claude-opus-5-5",
      output_config: { effort: "medium" },
      thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" }, type: "adaptive" },
    });
    for (const field of ["tool_choice", "temperature", "top_p", "top_k", "stop_sequences"]) {
      expect(body, field).not.toHaveProperty(field);
    }
    const names = deployedDefinition().tools.map((tool) => tool.name);
    expect(names).toEqual(names.toSorted());
    expect(JSON.stringify(body.tools)).not.toContain("eager_input_streaming");
  });

  it("logs every replayed thinking block the API dropped but those another model could not read", async () => {
    const { client } = recordingClient();
    const message = await client.beta.messages
      .stream(agentRequest(deployedDefinition(), [person(script("Hello."))], 2048))
      .finalMessage();
    expect(message.input_transformations).toEqual([]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const dropped: BetaMessage = {
      ...message,
      input_transformations: [
        {
          path: "messages.1.content.0",
          reason: "prefix_binding_mismatch",
          type: "thinking_dropped",
        },
        {
          path: "messages.3.content.0",
          reason: "model_binding_mismatch",
          type: "thinking_dropped",
        },
      ],
    };
    expect(logDroppedThinking("thread-1", dropped)).toBe(1);
    expect(logged).toHaveBeenCalledWith({
      event: "agent-thinking-dropped",
      path: "messages.1.content.0",
      reason: "prefix_binding_mismatch",
      threadId: "thread-1",
    });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
