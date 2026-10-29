// The fake's reply to one request, in place of sampling: the step the person's latest message asks
// for (`./fake-script.ts`), its usage, deterministic as no model's is, and the documented stream of
// events that carries it (platform.claude.com/docs/en/build-with-claude/streaming), typed by the
// SDK's own event union. Tokens are a quarter of a block's characters, rounded up; everything
// before the request's last breakpoint is read from the cache, the block that carries it is written
// at its lifetime, and what follows it is input. A reply thinks first, as an adaptive Opus 5.5
// does, its thinking signed against the request it answers (`./fake-signature.ts`).

import type {
  BetaContentBlock,
  BetaFallbackBlock,
  BetaIterationsUsage,
  BetaMessage,
  BetaRawContentBlockDelta,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
  BetaStopReason,
  BetaTextBlock,
  BetaThinkingBlock,
  BetaToolUseBlock,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { renderedBlocks } from "./fake-request.ts";
import type { FakeRequest } from "./fake-request.ts";
import { scriptOf, stepAt } from "./fake-script.ts";
import type { RefusalCategory, StallAt } from "./fake-script.ts";
import { signThinking } from "./fake-signature.ts";

export const FAKE_MODEL = "claude-opus-5-5";
// what a refusal of the request model falls back to, as `fallbacks: "default"` names it
export const FALLBACK_MODEL = "claude-opus-5";

// list output prices, dollars per million tokens, which a `spend` costs its tokens out at
const OUTPUT_PRICES = new Map([
  [FAKE_MODEL, 20],
  [FALLBACK_MODEL, 25],
]);

// a declined hop's own output before its refusal
const DECLINED_OUTPUT_TOKENS = 8;

// a thinking block before its signature, which depends on where the reply sits
type Planned =
  | { readonly type: "thinking"; readonly thinking: string }
  | BetaTextBlock
  | BetaToolUseBlock
  | BetaFallbackBlock;

interface Reply {
  readonly blocks: readonly Planned[];
  readonly stop: BetaStopReason;
  readonly refused: RefusalCategory | null;
  // the model whose output closes the reply: a fallback's, once one took the request up
  readonly servedBy: string;
  readonly slow: boolean;
  readonly stall: StallAt | null;
}

const tokensOf = (text: string): number => Math.ceil(text.length / 4);

const text = (words: string): BetaTextBlock => ({ citations: null, text: words, type: "text" });

// the person's latest message: the last user message with words of its own, not only results
const personAt = (request: FakeRequest): number =>
  request.messages.findLastIndex(
    (message) => message.role === "user" && message.content.some((block) => block.type === "text"),
  );

const toolsCalledSince = (request: FakeRequest, from: number): string[] =>
  request.messages
    .slice(from + 1)
    .flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((block) => (block.type === "tool_use" ? [block.name] : []))
        : [],
    );

const closing = (request: FakeRequest, person: number): Planned[] => {
  const called = toolsCalledSince(request, person);
  return [
    { thinking: "The steps are done; say what was done.", type: "thinking" },
    text(called.length === 0 ? "Done." : `Done: ${called.join(", ")}.`),
  ];
};

const textOfLength = (chars: number): string =>
  "The fake model's words fill this reply. ".repeat(Math.ceil(chars / 40)).slice(0, chars);

// what the step asks for, before its thinking is signed
const replyOf = (request: FakeRequest, toolIdPrefix: string): Reply => {
  const person = personAt(request);
  const words = (request.messages[person]?.content ?? []).flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
  const replies = request.messages
    .slice(person + 1)
    .filter((message) => message.role === "assistant").length;
  const { stall, step } = stepAt(scriptOf(words.join("\n")), replies);
  const base = { refused: null, servedBy: request.model, slow: false, stall };
  if (step === null) {
    return { ...base, blocks: closing(request, person), stop: "end_turn" };
  }
  switch (step.kind) {
    case "call": {
      const call: BetaToolUseBlock = {
        id: `${toolIdPrefix}_${String(replies)}`,
        input: step.input,
        name: step.tool,
        type: "tool_use",
      };
      return {
        ...base,
        blocks: [{ thinking: `Call ${step.tool} as the person asked.`, type: "thinking" }, call],
        stop: "tool_use",
      };
    }
    case "spend": {
      const price = OUTPUT_PRICES.get(request.model) ?? 0;
      const wanted = price === 0 ? 0 : Math.round((step.cents * 10_000) / price);
      const tokens = Math.min(wanted, request.max_tokens);
      return {
        ...base,
        blocks: [text(textOfLength(tokens * 4))],
        stop: tokens < wanted ? "max_tokens" : "end_turn",
      };
    }
    case "long": {
      return {
        ...base,
        blocks: [
          { thinking: "Write at length.", type: "thinking" },
          text(textOfLength(step.chars)),
        ],
        slow: true,
        stop: "end_turn",
      };
    }
    case "refuse": {
      return { ...base, blocks: [], refused: step.category, stop: "refusal" };
    }
    case "fallback": {
      if (request.fallbacks === undefined) {
        return { ...base, blocks: [], refused: "general_harms", stop: "refusal" };
      }
      const boundary: BetaFallbackBlock = {
        from: { model: request.model },
        to: { model: FALLBACK_MODEL },
        trigger: { category: "general_harms", type: "refusal" },
        type: "fallback",
      };
      return {
        ...base,
        blocks: [boundary, text("Answered by the fallback model.")],
        servedBy: FALLBACK_MODEL,
        stop: "end_turn",
      };
    }
    // no default
  }
};

// the request's input tokens as the cache bills them
const inputUsage = (request: FakeRequest) => {
  const blocks = renderedBlocks(request);
  const last = blocks.findLastIndex((block) => block.breakpoint !== null);
  const sum = (from: number, to: number): number => {
    let total = 0;
    for (const block of blocks.slice(from, to)) {
      total += tokensOf(block.json);
    }
    return total;
  };
  const written = last === -1 ? 0 : sum(last, last + 1);
  const lasting = last === -1 ? null : (blocks[last]?.breakpoint ?? null);
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: lasting === "1h" ? written : 0,
      ephemeral_5m_input_tokens: lasting === "5m" ? written : 0,
    },
    cache_creation_input_tokens: written,
    cache_read_input_tokens: last === -1 ? 0 : sum(0, last),
    input_tokens: last === -1 ? sum(0, blocks.length) : sum(last + 1, blocks.length),
  };
};

const outputTokensOf = (blocks: readonly Planned[]): number => {
  let total = 0;
  for (const block of blocks) {
    if (block.type === "thinking") {
      total += tokensOf(block.thinking);
    } else if (block.type === "text") {
      total += tokensOf(block.text);
    } else if (block.type === "tool_use") {
      total += tokensOf(JSON.stringify(block.input));
    }
  }
  return total;
};

const usageOf = (request: FakeRequest, reply: Reply): BetaUsage => {
  const input = inputUsage(request);
  const output = outputTokensOf(reply.blocks);
  const common = {
    fallback_credit: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
  } as const;
  if (reply.servedBy === request.model) {
    return { ...common, ...input, iterations: null, output_tokens: output };
  }
  const iterations: BetaIterationsUsage = [
    { ...input, model: request.model, output_tokens: DECLINED_OUTPUT_TOKENS, type: "message" },
    { ...input, model: reply.servedBy, output_tokens: output, type: "fallback_message" },
  ];
  return {
    ...common,
    cache_creation: {
      ephemeral_1h_input_tokens: 2 * input.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens: 2 * input.cache_creation.ephemeral_5m_input_tokens,
    },
    cache_creation_input_tokens: 2 * input.cache_creation_input_tokens,
    cache_read_input_tokens: 2 * input.cache_read_input_tokens,
    input_tokens: 2 * input.input_tokens,
    iterations,
    output_tokens: DECLINED_OUTPUT_TOKENS + output,
  };
};

const chunks = (whole: string, size: number): string[] => {
  const out: string[] = [];
  for (let at = 0; at < whole.length; at += size) {
    out.push(whole.slice(at, at + size));
  }
  return out.length === 0 ? [""] : out;
};

const refusalDetails = (category: RefusalCategory): BetaRefusalStopDetails => ({
  category,
  explanation: "The fake declined this request.",
  fallback_credit_token: null,
  fallback_has_prefill_claim: null,
  recommended_model: null,
  type: "refusal",
});

export interface StreamPlan {
  readonly events: readonly BetaRawMessageStreamEvent[];
  // the events sent before the reply holds, or null when it is sent whole
  readonly holdAfter: number | null;
  readonly delayMs: number;
}

export interface ReplyOptions {
  readonly id: string;
  readonly toolIdPrefix: string;
  readonly previousSignature: string | null;
  // the blocks the request's thinking check dropped, when it asked to hear of them
  readonly dropped: readonly string[] | null;
  // whether the stall a step asks for holds this sending of it
  readonly holds: (stall: StallAt) => boolean;
}

// the reply's events, its thinking signed for the place it takes, and where a stall holds them
export const planReply = async (
  request: FakeRequest,
  options: ReplyOptions,
): Promise<StreamPlan> => {
  const reply = replyOf(request, options.toolIdPrefix);
  const usage = usageOf(request, reply);
  const message: BetaMessage = {
    container: null,
    content: [],
    context_management: null,
    diagnostics: null,
    id: options.id,
    model: request.model,
    role: "assistant",
    stop_details: null,
    stop_reason: null,
    stop_sequence: null,
    type: "message",
    usage: { ...usage, output_tokens: 0 },
  };
  if (options.dropped !== null) {
    message.input_transformations = options.dropped.map((path) => ({
      path,
      reason: "prefix_binding_mismatch",
      type: "thinking_dropped",
    }));
  }
  const events: BetaRawMessageStreamEvent[] = [{ message, type: "message_start" }];
  // each block's deltas by their place in the stream, whose middle a stall holds
  const deltasOf: number[][] = [];
  for (const [index, planned] of reply.blocks.entries()) {
    const deltas: number[] = [];
    const delta = (body: BetaRawContentBlockDelta): void => {
      deltas.push(events.length);
      events.push({ delta: body, index, type: "content_block_delta" });
    };
    const start = (block: BetaContentBlock): void => {
      events.push({ content_block: block, index, type: "content_block_start" });
    };
    if (planned.type === "thinking") {
      start({ signature: "", thinking: "", type: "thinking" } satisfies BetaThinkingBlock);
      for (const piece of chunks(planned.thinking, 12)) {
        delta({ estimated_tokens: null, thinking: piece, type: "thinking_delta" });
      }
      const signature = await signThinking(request, planned.thinking, options.previousSignature);
      delta({ signature, type: "signature_delta" });
    } else if (planned.type === "text") {
      start(text(""));
      for (const piece of chunks(planned.text, reply.slow ? 40 : 10)) {
        delta({ text: piece, type: "text_delta" });
      }
    } else if (planned.type === "tool_use") {
      start({ ...planned, input: {} });
      for (const piece of chunks(JSON.stringify(planned.input), 9)) {
        delta({ partial_json: piece, type: "input_json_delta" });
      }
    } else {
      start(planned);
    }
    events.push({ index, type: "content_block_stop" });
    deltasOf.push(deltas);
  }
  events.push(
    {
      context_management: null,
      delta: {
        container: null,
        stop_details: reply.refused === null ? null : refusalDetails(reply.refused),
        stop_reason: reply.stop,
        stop_sequence: null,
      },
      type: "message_delta",
      usage,
    },
    { type: "message_stop" },
  );
  const thinkingAt = reply.blocks.findIndex((block) => block.type === "thinking");
  const holdIn =
    reply.stall === "thinking" && thinkingAt !== -1 ? thinkingAt : reply.blocks.length - 1;
  const held = deltasOf[holdIn] ?? [];
  const middle = held[Math.floor(held.length / 2)];
  const holds = reply.stall !== null && middle !== undefined && options.holds(reply.stall);
  return { delayMs: reply.slow ? 25 : 0, events, holdAfter: holds ? middle : null };
};
