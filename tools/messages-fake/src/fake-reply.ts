// The fake's reply to one request, in place of sampling: the step the person's latest message asks
// for (`./fake-script.ts`), its usage, deterministic as no model's is, and the documented stream of
// events that carries it (platform.claude.com/docs/en/build-with-claude/streaming), typed by the
// SDK's own event union. Tokens are a quarter of a block's characters, rounded up; everything
// before the request's last breakpoint is read from the cache, the block that carries it is written
// at its lifetime, and what follows it is input. A reply thinks first, as an adaptive Sonnet
// 5.5 does, and writes a progress note in a thinking block of its own before each tool call, each
// signed against the request it answers (`./fake-signature.ts`); what a thinking block shows is
// what the request's `thinking.display` asks for: the note alone under `updates`, every block's
// words under `summarized`, nothing otherwise. A step the script marks `compact` opens with a
// compaction block, when the request asks for compaction: its summary carries, as the fake's own
// opaque content, the person's words and the replies since, which is all a later request that
// starts from the block tells of them
// (platform.claude.com/docs/en/build-with-claude/compaction-threshold).

import type {
  BetaCompactionBlock,
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
import { z } from "zod";

import { anchorOf, asksCompaction, renderedBlocks } from "./fake-request.ts";
import type { FakeBlock, FakeRequest } from "./fake-request.ts";
import type { RefusalCategory, ScriptedStep, StallAt } from "./fake-script.ts";
import { signThinking } from "./fake-signature.ts";

export const FAKE_MODEL = "claude-sonnet-5-5";
// what a refusal of the request model falls back to, as `fallbacks: "default"` names it
const FALLBACK_MODEL = "claude-sonnet-5";

// a declined hop's own output before its refusal
const DECLINED_OUTPUT_TOKENS = 8;

const SUMMARY = "The fake summarized the conversation so far.";

// a thinking block before its signature, which depends on where the reply sits: its reasoning, or
// the progress note that introduces the tool call after it
interface PlannedThinking {
  readonly type: "thinking";
  readonly kind: "reasoning" | "progress";
  readonly words: string;
}

type Planned =
  | PlannedThinking
  | BetaTextBlock
  | BetaToolUseBlock
  | BetaFallbackBlock
  | (BetaCompactionBlock & { readonly content: string; readonly encrypted_content: string });

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

const reasoning = (words: string): PlannedThinking => ({
  kind: "reasoning",
  type: "thinking",
  words,
});

// ---- the conversation the request carries ----

// what the fake's compaction keeps of the conversation it summarized, in its opaque content
const keptSchema = z.object({
  called: z.array(z.string()),
  person: z.string(),
  replies: z.number().int().nonnegative(),
});

type Kept = z.infer<typeof keptSchema>;

const keptTextSchema = z
  .string()
  .transform((value, context) => {
    try {
      return z.json().parse(JSON.parse(value));
    } catch {
      context.addIssue({ code: "custom", message: "is not JSON" });
      return z.NEVER;
    }
  })
  .pipe(keptSchema);

const NOTHING_KEPT: Kept = { called: [], person: "", replies: 0 };

const keptOf = (block: FakeBlock | undefined): Kept => {
  if (block?.type !== "compaction") {
    return NOTHING_KEPT;
  }
  const kept = keptTextSchema.safeParse(block.encrypted_content);
  return kept.success ? kept.data : NOTHING_KEPT;
};

const wordsOf = (content: readonly FakeBlock[]): string =>
  content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

// what the request tells of the person's latest message: their words, how many replies came
// since, and the tools those called, read from the last compaction block on as the API reads it;
// a person's message the compaction summarized is read from what it kept
export const conversationOf = (request: FakeRequest): Kept => {
  const anchor = anchorOf(request);
  const seen = request.messages.slice(anchor?.index ?? 0);
  const person = seen.findLastIndex(
    (message) => message.role === "user" && message.content.some((block) => block.type === "text"),
  );
  const kept =
    person === -1
      ? keptOf(anchor === null ? undefined : seen[0]?.content[anchor.at])
      : { ...NOTHING_KEPT, person: wordsOf(seen[person]?.content ?? []) };
  const since = seen.slice(person + 1).filter((message) => message.role === "assistant");
  return {
    called: [
      ...kept.called,
      ...since.flatMap((message) =>
        message.content.flatMap((block) => (block.type === "tool_use" ? [block.name] : [])),
      ),
    ],
    person: kept.person,
    replies: kept.replies + since.length,
  };
};

// ---- the reply ----

const closing = (called: readonly string[]): Planned[] => [
  reasoning("The steps are done; say what was done."),
  text(called.length === 0 ? "Done." : `Done: ${called.join(", ")}.`),
];

const textOfLength = (chars: number): string =>
  "The fake model's words fill this reply. ".repeat(Math.ceil(chars / 40)).slice(0, chars);

// the step's own blocks, before any compaction opens them
const stepReply = (
  request: FakeRequest,
  conversation: Kept,
  step: ScriptedStep["step"],
  toolIdPrefix: string,
): Omit<Reply, "stall"> => {
  const base = { refused: null, servedBy: request.model, slow: false };
  if (step === null) {
    return { ...base, blocks: closing(conversation.called), stop: "end_turn" };
  }
  switch (step.kind) {
    case "call": {
      const call: BetaToolUseBlock = {
        id: `${toolIdPrefix}_${String(conversation.replies)}`,
        input: step.input,
        name: step.tool,
        type: "tool_use",
      };
      return {
        ...base,
        blocks: [
          reasoning(`Call ${step.tool} as the person asked.`),
          { kind: "progress", type: "thinking", words: `Calling ${step.tool} now.` },
          call,
        ],
        stop: "tool_use",
      };
    }
    case "long": {
      return {
        ...base,
        blocks: [reasoning("Write at length."), text(textOfLength(step.chars))],
        slow: true,
        stop: "end_turn",
      };
    }
    case "refuse": {
      return { ...base, blocks: [], refused: step.category, stop: "refusal" };
    }
    case "fallback": {
      if (request.fallbacks === undefined) {
        return { ...base, blocks: [], refused: "cyber", stop: "refusal" };
      }
      const boundary: BetaFallbackBlock = {
        from: { model: request.model },
        to: { model: FALLBACK_MODEL },
        trigger: { category: "cyber", type: "refusal" },
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

// what the step asks for, opened by a compaction when it asks for one and the request does too,
// before its thinking is signed
const replyOf = (request: FakeRequest, options: ReplyOptions): Reply => {
  const { conversation, step } = options;
  const { compact, stall } = step;
  const reply = stepReply(request, conversation, step.step, options.toolIdPrefix);
  if (!compact || !asksCompaction(request)) {
    return { ...reply, stall };
  }
  const compaction = {
    content: SUMMARY,
    encrypted_content: JSON.stringify(conversation satisfies Kept),
    type: "compaction",
  } as const;
  return { ...reply, blocks: [compaction, ...reply.blocks], stall };
};

// what a thinking block shows under the request's display: the note under `updates`, every
// block's words under `summarized`, and nothing under `omitted`, Sonnet 5.5's default
const shownOf = (planned: PlannedThinking, request: FakeRequest): string => {
  const display = request.thinking?.display ?? "omitted";
  if (display === "summarized" || (display === "updates" && planned.kind === "progress")) {
    return planned.words;
  }
  return "";
};

// ---- usage ----

interface InputUsage {
  readonly cache_creation: {
    readonly ephemeral_1h_input_tokens: number;
    readonly ephemeral_5m_input_tokens: number;
  };
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly input_tokens: number;
}

const sumOf = (blocks: readonly { readonly json: string }[]): number => {
  let total = 0;
  for (const block of blocks) {
    total += tokensOf(block.json);
  }
  return total;
};

// the request's input tokens as the cache bills them
const inputUsage = (request: FakeRequest): InputUsage => {
  const blocks = renderedBlocks(request);
  const last = blocks.findLastIndex((block) => block.breakpoint !== null);
  const written = last === -1 ? 0 : sumOf(blocks.slice(last, last + 1));
  const lasting = last === -1 ? null : (blocks[last]?.breakpoint ?? null);
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: lasting === "1h" ? written : 0,
      ephemeral_5m_input_tokens: lasting === "5m" ? written : 0,
    },
    cache_creation_input_tokens: written,
    cache_read_input_tokens: last === -1 ? 0 : sumOf(blocks.slice(0, last)),
    input_tokens: last === -1 ? sumOf(blocks) : sumOf(blocks.slice(last + 1)),
  };
};

// what the model reads once a compaction ran: the system and the tools, cached, and the summary
const compactedUsage = (request: FakeRequest): InputUsage => ({
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: sumOf(
    [...(request.tools ?? []), ...(request.system ?? [])].map((block) => ({
      json: JSON.stringify(block),
    })),
  ),
  input_tokens: tokensOf(SUMMARY),
});

// a reply's output, its thinking billed at its whole length whatever it shows
const outputTokensOf = (blocks: readonly Planned[]): number => {
  let total = 0;
  for (const block of blocks) {
    if (block.type === "thinking") {
      total += tokensOf(block.words);
    } else if (block.type === "text") {
      total += tokensOf(block.text);
    } else if (block.type === "tool_use") {
      total += tokensOf(JSON.stringify(block.input));
    }
  }
  return total;
};

const added = (parts: readonly InputUsage[]): InputUsage => ({
  cache_creation: {
    ephemeral_1h_input_tokens: parts.reduce(
      (sum, part) => sum + part.cache_creation.ephemeral_1h_input_tokens,
      0,
    ),
    ephemeral_5m_input_tokens: parts.reduce(
      (sum, part) => sum + part.cache_creation.ephemeral_5m_input_tokens,
      0,
    ),
  },
  cache_creation_input_tokens: parts.reduce(
    (sum, part) => sum + part.cache_creation_input_tokens,
    0,
  ),
  cache_read_input_tokens: parts.reduce((sum, part) => sum + part.cache_read_input_tokens, 0),
  input_tokens: parts.reduce((sum, part) => sum + part.input_tokens, 0),
});

// the reply's usage: each sampling step an entry of `iterations` (a compaction's, the request
// model's, a fallback's), which the compaction beta asks for on every reply, and the top level
// every step's but a compaction's, as the API reports it
const usageOf = (request: FakeRequest, reply: Reply, iterating: boolean): BetaUsage => {
  const compaction = reply.blocks.find((block) => block.type === "compaction");
  const whole = inputUsage(request);
  const input = compaction === undefined ? whole : compactedUsage(request);
  const output = outputTokensOf(reply.blocks);
  const answered: BetaIterationsUsage =
    reply.servedBy === request.model
      ? [{ ...input, model: request.model, output_tokens: output, type: "message" }]
      : [
          {
            ...input,
            model: request.model,
            output_tokens: DECLINED_OUTPUT_TOKENS,
            type: "message",
          },
          { ...input, model: reply.servedBy, output_tokens: output, type: "fallback_message" },
        ];
  const iterations: BetaIterationsUsage =
    compaction === undefined
      ? answered
      : [
          { ...whole, output_tokens: tokensOf(compaction.content), type: "compaction" },
          ...answered,
        ];
  const top = added(answered.map(() => input));
  return {
    ...top,
    fallback_credit: null,
    inference_geo: null,
    iterations: iterating || answered.length > 1 ? iterations : null,
    output_tokens: answered.reduce((sum, part) => sum + part.output_tokens, 0),
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
  };
};

// ---- the stream ----

const chunks = (whole: string, size: number): string[] => {
  const out: string[] = [];
  for (let at = 0; at < whole.length; at += size) {
    out.push(whole.slice(at, at + size));
  }
  return out;
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
  // the request's conversation and the step of its script it asks for, read once a request
  readonly conversation: Kept;
  readonly step: ScriptedStep;
  readonly id: string;
  readonly toolIdPrefix: string;
  readonly previousSignature: string | null;
  // the blocks the request's thinking check dropped, when it asked to hear of them
  readonly dropped: readonly string[] | null;
  // whether every reply reports its iterations, as the compaction beta asks
  readonly iterating: boolean;
  // whether the stall a step asks for holds this sending of it
  readonly holds: (stall: StallAt) => boolean;
}

// a planned block as the client will carry it back once the stream ends
const replayedOf = (planned: Planned, request: FakeRequest, signature: string): FakeBlock => {
  switch (planned.type) {
    case "thinking": {
      return { signature, thinking: shownOf(planned, request), type: "thinking" };
    }
    case "compaction": {
      return {
        content: planned.content,
        encrypted_content: planned.encrypted_content,
        type: "compaction",
      };
    }
    case "text": {
      return { citations: null, text: planned.text, type: "text" };
    }
    case "tool_use": {
      return {
        id: planned.id,
        input: z.json().parse(planned.input),
        name: planned.name,
        type: "tool_use",
      };
    }
    case "fallback": {
      return {
        from: { model: planned.from.model },
        to: { model: planned.to.model },
        type: "fallback",
      };
    }
    // no default
  }
};

// the reply's events, its thinking signed for the place it takes, and where a stall holds them
export const planReply = async (
  request: FakeRequest,
  options: ReplyOptions,
): Promise<StreamPlan> => {
  const reply = replyOf(request, options);
  const usage = usageOf(request, reply, options.iterating);
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
  // what the reply carries back before each block, and the thinking block each one chains to: a
  // compaction starts the chain afresh
  const before: FakeBlock[] = [];
  let previous = options.previousSignature;
  for (const [index, planned] of reply.blocks.entries()) {
    const deltas: number[] = [];
    const delta = (body: BetaRawContentBlockDelta): void => {
      deltas.push(events.length);
      events.push({ delta: body, index, type: "content_block_delta" });
    };
    const start = (block: BetaContentBlock): void => {
      events.push({ content_block: block, index, type: "content_block_start" });
    };
    let signature = "";
    if (planned.type === "thinking") {
      start({ signature: "", thinking: "", type: "thinking" } satisfies BetaThinkingBlock);
      const shown = shownOf(planned, request);
      for (const piece of chunks(shown, 12)) {
        delta({ estimated_tokens: null, thinking: piece, type: "thinking_delta" });
      }
      signature = await signThinking(request, { before, thinking: shown }, previous);
      previous = signature;
      delta({ signature, type: "signature_delta" });
    } else if (planned.type === "compaction") {
      // the summary arrives whole, in one delta (compaction-threshold § Streaming)
      start({ content: null, encrypted_content: null, type: "compaction" });
      delta({
        content: planned.content,
        encrypted_content: planned.encrypted_content,
        type: "compaction_delta",
      });
      previous = null;
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
    before.push(replayedOf(planned, request, signature));
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
  const thinkingAt = reply.blocks.findLastIndex((block) => block.type === "thinking");
  const holdIn =
    reply.stall === "thinking" && thinkingAt !== -1 ? thinkingAt : reply.blocks.length - 1;
  const held = deltasOf[holdIn] ?? [];
  const middle = held[Math.floor(held.length / 2)];
  const holds = reply.stall !== null && middle !== undefined && options.holds(reply.stall);
  return { delayMs: reply.slow ? 25 : 0, events, holdAfter: holds ? middle : null };
};
