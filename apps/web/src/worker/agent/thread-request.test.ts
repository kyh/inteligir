// One request of a conversation, as the thread builds it from its frozen definition and its
// transcript, sent through the thread's own client to the scripted Messages API and its replies
// replayed as the thread keeps them: consecutive bodies share their system, their tools and every
// message they both carry, byte for byte as sent, key order included, but for the breakpoints, so
// each replayed thinking block meets the prefix it was signed against; three breakpoints, the
// hour's first; a message is its role and content alone, and the last is never the assistant's.
// What a request carries of the transcript: from the last compaction that kept a summary on, and
// before the turn a definition was taken up at, no thinking.

import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fakeStats, script } from "../test-support/agent-turns";
import { expectSharedPrefixes } from "../test-support/request-bodies";
import { anthropicClient } from "./anthropic-client";
import {
  agentRequest,
  deployedDefinition,
  logDroppedThinking,
  replyBlocksOf,
  requestMessages,
  transcriptMessage,
} from "./thread-request";
import type { SequencedMessage, TranscriptMessage } from "./thread-request";

const blockSchema = z.record(z.string(), z.json());

const bodySchema = z.looseObject({
  messages: z.array(z.strictObject({ content: z.array(blockSchema), role: z.string() })),
  system: z.array(blockSchema),
  tools: z.array(blockSchema),
});

type Body = z.infer<typeof bodySchema>;

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
    expectSharedPrefixes(sent);
    // the breakpoint went on a copy: what the thread keeps carries none
    expect(JSON.stringify(transcript)).not.toContain("cache_control");
    const stats = await fakeStats();
    expect(stats.drops).toBe(0);
  });

  it("sends the definition's model and effort, adaptive thinking that drops what fails and shows its notes, compaction at the threshold, and no sampling", () => {
    const body = agentRequest(deployedDefinition(), [person("Hello.")], 2048);
    expect(body).toMatchObject({
      betas: [
        "thinking-binding-controls-2026-08-01",
        "server-side-fallback-2026-07-01",
        "compact-2026-01-12",
        "thinking-display-updates-2026-08-18",
      ],
      // the API's own trigger, 150,000 input tokens, and its own summary prompt
      context_management: { edits: [{ type: "compact_20260112" }] },
      fallbacks: "default",
      max_tokens: 2048,
      model: "claude-opus-5-5",
      output_config: { effort: "medium" },
      thinking: {
        block_binding: { prefix_mismatch_behavior: "drop_block" },
        display: "updates",
        type: "adaptive",
      },
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

// a transcript's rows, numbered as the thread keeps them
const numbered = (messages: readonly TranscriptMessage[]): SequencedMessage[] =>
  messages.map((message, index) => ({ ...message, seq: index + 1 }));

const reply = (...content: readonly unknown[]): TranscriptMessage =>
  transcriptMessage("assistant", JSON.stringify(content));

const thought = (thinking: string) => ({
  signature: `sig-${thinking}`,
  thinking,
  type: "thinking",
});

const words = (text: string) => ({ citations: null, text, type: "text" });

const rules = (text: string): TranscriptMessage =>
  transcriptMessage("system", JSON.stringify([{ text, type: "text" }]));

const results = (id: string): TranscriptMessage =>
  transcriptMessage(
    "user",
    JSON.stringify([{ content: "{}", tool_use_id: id, type: "tool_result" }]),
  );

const typesOf = (messages: readonly TranscriptMessage[]) =>
  messages.map((message) => [message.role, ...message.content.map((block) => block.type)]);

const call = (id: string) => ({ id, input: {}, name: "search_library", type: "tool_use" });

describe("what a request carries of the transcript", () => {
  it("carries it whole while one definition holds from the thread's first row", () => {
    const transcript = numbered([
      person("Find Paris."),
      reply(thought("a"), call("t1")),
      results("t1"),
      reply(thought("b"), words("Found.")),
    ]);
    expect(requestMessages(transcript, 1)).toEqual(transcript);
  });

  it("leaves out every thinking block before the turn a definition was taken up at, and nothing after", () => {
    const transcript = numbered([
      person("Find Paris."),
      reply(thought("a"), thought("note"), call("t1")),
      results("t1"),
      reply(thought("b"), words("Found.")),
      person("And Lyon?"),
      reply(thought("c"), call("t2")),
      results("t2"),
    ]);
    expect(typesOf(requestMessages(transcript, 5))).toEqual([
      ["user", "text"],
      ["assistant", "tool_use"],
      ["user", "tool_result"],
      ["assistant", "text"],
      ["user", "text"],
      ["assistant", "thinking", "tool_use"],
      ["user", "tool_result"],
    ]);
    // the stored rows are left as they were
    expect(transcript[1]?.content.map((block) => block.type)).toEqual([
      "thinking",
      "thinking",
      "tool_use",
    ]);
  });

  it("leaves out a reply left with nothing, and the system message it alone followed", () => {
    // a reply cut at max_tokens while it thought, after the filing rules its turn sent
    const transcript = numbered([
      person("Think hard."),
      rules("File trips under Travel."),
      reply(thought("long")),
      person("Again."),
      reply({ data: "opaque", type: "redacted_thinking" }, words("Done.")),
      person("Once more."),
    ]);
    expect(typesOf(requestMessages(transcript, 6))).toEqual([
      ["user", "text"],
      ["user", "text"],
      ["assistant", "text"],
      ["user", "text"],
    ]);
  });

  it("reads the conversation from the last compaction that kept a summary, one that wrote none anchoring nothing", () => {
    const summary = { content: "The summary.", encrypted_content: "opaque", type: "compaction" };
    const failed = { content: null, encrypted_content: null, type: "compaction" };
    const transcript = numbered([
      person("Find Paris."),
      reply(thought("a"), call("t1")),
      results("t1"),
      reply(summary, thought("b"), call("t2")),
      results("t2"),
      reply(failed, thought("c"), words("Found.")),
      person("And Lyon?"),
    ]);
    const sent = requestMessages(transcript, 1);
    expect(sent).toEqual(transcript.slice(3));
    // a definition taken up after the compaction leaves out the thinking from it on
    expect(typesOf(requestMessages(transcript, 7))).toEqual([
      ["assistant", "compaction", "tool_use"],
      ["user", "tool_result"],
      ["assistant", "compaction", "text"],
      ["user", "text"],
    ]);
  });
});
