// One request of a conversation, built from the definition the thread's turns are sent under and
// its transcript: the definition's model and effort (`./library-agent`), adaptive thinking whose
// replayed blocks are dropped rather than refused when they fail the conversation check and whose
// progress notes between tool calls come back as text, a refusal answered by the fallback model
// Anthropic names for its category inside the same call
// (platform.claude.com/docs/en/build-with-claude/refusals-and-fallback), and the conversation
// compacted on the server once its input reaches 50,000 tokens, the least threshold the API takes
// (platform.claude.com/docs/en/build-with-claude/compaction-threshold). The system and the tools
// are the definition's, byte for byte, each closed by a 1-hour cache breakpoint, so every
// conversation of every account reads one cached prefix; the last block of the last message
// carries a 5-minute one on a copy, so each step reads the steps before it. A message is its role
// and content alone, never an assistant's last: a replayed thinking block is checked against
// everything before it from the last compaction block on, and a field the API does not expect is a
// 400. What the transcript holds reaches a request by one rule, the same on every request, so a
// prefix never moves once a block is bound to it: nothing before the last compaction that kept a
// summary, which the API ignores, and before the turn the thread took up its definition at, no
// thinking block, which that definition's system and tools would fail, the leading run the API
// lets go. No tool choice, no sampling, no eager input streaming. A drop is a bug, so every one is
// logged.

import type {
  BetaCacheControlEphemeral,
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaTextBlockParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { sha256Hex } from "@repo/contract/bytes";
import { z } from "zod";

import { AGENT_SYSTEM_PROMPT } from "./agent-prompt";
import { AGENT_TOOL_DEFINITIONS } from "./agent-tools";
import { AGENT_MODEL } from "./library-agent";
import type { CallEstimate } from "./thread-wire";

// the thinking-block binding control, server-side fallback on a refusal, threshold compaction, and
// the progress notes between tool calls shown
/** @internal */
export const AGENT_BETAS = [
  "thinking-binding-controls-2026-08-01",
  "server-side-fallback-2026-07-01",
  "compact-2026-01-12",
  "thinking-display-updates-2026-08-18",
] as const;

const HOUR_CACHE = { ttl: "1h", type: "ephemeral" } as const;
const ROLLING_CACHE = { type: "ephemeral" } as const;

// the input a request is compacted at, the least the API takes: a turn's first call after a pause
// is reserved with its prompt written to the cache again, and one that may compact with the
// summary's pass beside the answer (`./agent-allowance`), which a prompt this long still leaves
// room in a turn's ceiling for; at the API's default, 150,000, the input alone costs more than the
// ceiling, so such a thread would end every turn refused before its first call and never compact
export const COMPACTION_TRIGGER_TOKENS = 50_000;

// ---- what a transcript row holds ----

const textSchema = z.looseObject({ text: z.string(), type: z.literal("text") });
const thinkingSchema = z.looseObject({
  signature: z.string(),
  thinking: z.string(),
  type: z.literal("thinking"),
});
const redactedSchema = z.looseObject({ data: z.string(), type: z.literal("redacted_thinking") });
const toolUseSchema = z.looseObject({
  id: z.string(),
  input: z.record(z.string(), z.json()),
  name: z.string(),
  type: z.literal("tool_use"),
});
const fallbackSchema = z.looseObject({
  from: z.looseObject({ model: z.string() }),
  to: z.looseObject({ model: z.string() }),
  type: z.literal("fallback"),
});
// the API's summary of the conversation before it, or null when it wrote none, replayed as
// returned: a request reads the conversation from the last one that kept a summary
const compactionSchema = z.looseObject({
  content: z.string().nullable(),
  type: z.literal("compaction"),
});
const toolResultSchema = z.looseObject({
  content: z.string(),
  is_error: z.boolean().optional(),
  tool_use_id: z.string(),
  type: z.literal("tool_result"),
});

// what a reply of Claude's may hold, every one replayed as returned; a reply holding any other
// block is one this build cannot replay, and its turn fails
const replyBlockSchema = z.discriminatedUnion("type", [
  textSchema,
  thinkingSchema,
  redactedSchema,
  toolUseSchema,
  fallbackSchema,
  compactionSchema,
]);
export type ReplyBlock = z.infer<typeof replyBlockSchema>;

// what the thread writes as the person's, and the tools' answers
const userBlockSchema = z.discriminatedUnion("type", [textSchema, toolResultSchema]);
type UserBlock = z.infer<typeof userBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultSchema>;
type TextBlock = z.infer<typeof textSchema>;

export type TranscriptMessage =
  | { readonly role: "user"; readonly content: readonly UserBlock[] }
  | { readonly role: "assistant"; readonly content: readonly ReplyBlock[] }
  | { readonly role: "system"; readonly content: readonly TextBlock[] };

// each validated, never parsed: a value narrowed keeps its keys in the order they were written,
// which a parse would not
const userContent = z.array(userBlockSchema).min(1);
const replyContent = z.array(replyBlockSchema).min(1);
const systemContent = z.array(textSchema).min(1);

// a stored row as the message it replays: the content exactly as it was written
export const transcriptMessage = (role: string, content: string): TranscriptMessage => {
  const value: unknown = JSON.parse(content);
  if (role === "user" && userContent.validate(value)) {
    return { content: value, role };
  }
  if (role === "assistant" && replyContent.validate(value)) {
    return { content: value, role };
  }
  if (role === "system" && systemContent.validate(value)) {
    return { content: value, role };
  }
  throw new Error(`a ${role} row holds content this build cannot replay`);
};

// a reply's blocks, or null when it holds one this build cannot replay
export const replyBlocksOf = (content: readonly BetaContentBlock[]): ReplyBlock[] | null => {
  const blocks: unknown = content;
  if (content.length === 0) {
    return [];
  }
  return replyContent.validate(blocks) ? [...blocks] : null;
};

// ---- the definition ----

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly NonNullable<
  BetaOutputConfig["effort"]
>[];

// what a turn is sent under: the model and its effort, the system blocks and the tool definitions
export interface ThreadDefinition {
  readonly model: string;
  readonly effort: (typeof EFFORTS)[number];
  readonly system: readonly BetaTextBlockParam[];
  readonly tools: readonly BetaTool[];
}

const toolSchema = z.looseObject({
  description: z.string().optional(),
  input_schema: z.looseObject({ type: z.literal("object") }),
  name: z.string(),
});

// a definition as its row keeps it: the system and the tools as the JSON they are sent as
export interface FrozenDefinition {
  readonly model: string;
  readonly effort: string;
  readonly system: string;
  readonly tools: string;
}

const toolsContent = z.array(toolSchema);

// a definition row as the thread froze it, its system and tools validated, never parsed, so each
// keeps its keys in the order they were sent
export const storedDefinition = (row: FrozenDefinition): ThreadDefinition => {
  const system: unknown = JSON.parse(row.system);
  const tools: unknown = JSON.parse(row.tools);
  if (!systemContent.validate(system) || !toolsContent.validate(tools)) {
    throw new Error("a definition row holds a system or tools this build cannot send");
  }
  return {
    effort: z.enum(EFFORTS).parse(row.effort),
    model: z.string().min(1).parse(row.model),
    system,
    tools,
  };
};

// what this deployment would start a turn under: its model and effort, and the prompt and the tools
// as they stand
export const deployedDefinition = (): ThreadDefinition => ({
  effort: AGENT_MODEL.effort,
  model: AGENT_MODEL.id,
  system: [{ text: AGENT_SYSTEM_PROMPT, type: "text" }],
  tools: AGENT_TOOL_DEFINITIONS,
});

// the definition as its row keeps it, and the hash a deploy's definition is told apart by
export const frozenDefinition = async (
  definition: ThreadDefinition,
): Promise<FrozenDefinition & { readonly hash: string }> => {
  const frozen: FrozenDefinition = {
    effort: definition.effort,
    model: definition.model,
    system: JSON.stringify(definition.system),
    tools: JSON.stringify(definition.tools),
  };
  return { ...frozen, hash: await sha256Hex(JSON.stringify(frozen)) };
};

// ---- the request ----

// a copy of the last entry carrying `cache_control`, the stored ones left alone
const closedBy = <T extends object>(entries: readonly T[], cache: BetaCacheControlEphemeral): T[] =>
  entries.map((entry, index) =>
    index === entries.length - 1 ? { ...entry, cache_control: cache } : entry,
  );

const isThinking = (block: { readonly type: string }): boolean =>
  block.type === "thinking" || block.type === "redacted_thinking";

// a message as the thread keeps it, by its place in the transcript
export type SequencedMessage = TranscriptMessage & { readonly seq: number };

// a reply holding a compaction that kept a summary: the API reads the conversation from it on
const compacts = (message: TranscriptMessage): boolean =>
  message.role === "assistant" &&
  message.content.some((block) => block.type === "compaction" && block.content !== null);

// what a request carries of the transcript: every message from the last reply whose compaction
// kept a summary on, since the API ignores what it summarized; and of the messages before
// `sinceSeq`, the first of the turn the thread took up its definition at, none of their thinking,
// a reply left with nothing left out with the system message it alone followed, since a system
// message is followed by an assistant's or by nothing
export const requestMessages = (
  transcript: readonly SequencedMessage[],
  sinceSeq: number,
): TranscriptMessage[] => {
  const sent: TranscriptMessage[] = [];
  for (const message of transcript.slice(Math.max(0, transcript.findLastIndex(compacts)))) {
    if (message.role !== "assistant" || message.seq >= sinceSeq) {
      sent.push(message);
      continue;
    }
    const content = message.content.filter((block) => !isThinking(block));
    if (content.length > 0) {
      sent.push({ content, role: "assistant" });
    } else if (sent.at(-1)?.role === "system") {
      sent.pop();
    }
  }
  return sent;
};

// the message as the API takes it: its role and content and nothing else, the last message's last
// block carrying the rolling breakpoint, on a copy, unless it is a thinking block
const messageParam = (message: TranscriptMessage, last: boolean): BetaMessageParam => {
  const rolling = last ? ROLLING_CACHE : null;
  switch (message.role) {
    case "user": {
      return {
        content: rolling === null ? [...message.content] : closedBy(message.content, rolling),
        role: "user",
      };
    }
    case "system": {
      return {
        content: rolling === null ? [...message.content] : closedBy(message.content, rolling),
        role: "system",
      };
    }
    case "assistant": {
      const lastBlock = message.content.at(-1);
      return {
        content:
          rolling === null || lastBlock === undefined || isThinking(lastBlock)
            ? [...message.content]
            : closedBy(message.content, rolling),
        role: "assistant",
      };
    }
    // no default
  }
};

// the request for `messages`, which `requestMessages` read off the transcript
export const agentRequest = (
  definition: ThreadDefinition,
  messages: readonly TranscriptMessage[],
  maxTokens: number,
): BetaMessageStreamParams => ({
  betas: [...AGENT_BETAS],
  context_management: {
    edits: [
      {
        trigger: { type: "input_tokens", value: COMPACTION_TRIGGER_TOKENS },
        type: "compact_20260112",
      },
    ],
  },
  fallbacks: "default",
  max_tokens: maxTokens,
  messages: messages.map((message, index) => messageParam(message, index === messages.length - 1)),
  model: definition.model,
  output_config: { effort: definition.effort },
  system: closedBy(definition.system, HOUR_CACHE),
  thinking: {
    block_binding: { prefix_mismatch_behavior: "drop_block" },
    display: "updates",
    type: "adaptive",
  },
  tools: closedBy(definition.tools, HOUR_CACHE),
});

// every replayed thinking block the API dropped, logged by where it sat: a fallback model reads
// none of Opus 5.5's, which is no bug, and every other drop is one
export const logDroppedThinking = (threadId: string, message: BetaMessage): void => {
  for (const entry of message.input_transformations ?? []) {
    if (entry.type === "thinking_dropped" && entry.reason !== "model_binding_mismatch") {
      console.error({
        event: "agent-thinking-dropped",
        path: entry.path,
        reason: entry.reason,
        threadId,
      });
    }
  }
};

// ---- what a request costs to send, as the cell prices a reservation ----

// a chain longer than this is no word, and is counted as an id is
const WORD_MAX = 16;

const isDigit = (point: number): boolean => point >= 0x30 && point <= 0x39;
const isLetter = (point: number): boolean =>
  (point >= 0x41 && point <= 0x5a) || (point >= 0x61 && point <= 0x7a);
// the marks that join an id's or a file's parts, `+ - . / = _`: a uuid's hyphens, base64's `+`,
// `/` and `=`, a name's dots and underscores
const JOINERS: ReadonlySet<number> = new Set([0x2b, 0x2d, 0x2e, 0x2f, 0x3d, 0x5f]);

// a character beyond ASCII as UTF-8 writes it
const utf8Bytes = (point: number): number => {
  if (point < 0x8_00) {
    return 2;
  }
  return point < 0x1_00_00 ? 3 : 4;
};

// The most tokens `text` is billed as, counted in tenths of a token over its chains, each a run of
// ASCII letters, digits and the marks that join an id's parts. A word, a chain of at most sixteen
// with no digit, at 0.4 a letter and half a token a mark, as a space or any other ASCII is: more
// than the 1.3 tokens the Opus 4.7 family's tokenizer spends where earlier ones spent one on 3.5
// English characters (platform.claude.com/docs/en/about-claude/glossary), 0.37 a character. Any
// other chain (a number, a sha, an id, base64, a word past sixteen) at a token a character, and
// each character beyond ASCII (CJK, accents, emoji) at a token a UTF-8 byte: the most a tokenizer
// that reads text by the byte can spend, the same glossary's "or even bytes".
/** @internal */
export const tokensAtMost = (text: string): number => {
  let tenths = 0;
  let chain = 0;
  let letters = 0;
  let digits = 0;
  const closeChain = (): void => {
    tenths += digits > 0 || chain > WORD_MAX ? 10 * chain : 4 * letters + 5 * (chain - letters);
    chain = 0;
    letters = 0;
    digits = 0;
  };
  for (let at = 0; at < text.length;) {
    const point = text.codePointAt(at) ?? 0;
    at += point > 0xff_ff ? 2 : 1;
    if (isLetter(point) || isDigit(point) || JOINERS.has(point)) {
      chain += 1;
      letters += isLetter(point) ? 1 : 0;
      digits += isDigit(point) ? 1 : 0;
      continue;
    }
    closeChain();
    tenths += point < 0x80 ? 5 : 10 * utf8Bytes(point);
  }
  closeChain();
  return Math.ceil(tenths / 10);
};

// the last call sent under the definition in force: when it landed, the prompt it was billed, and
// the reply it wrote, which the transcript replays, in tokens
export interface CallAnchor {
  readonly endedAt: number;
  readonly promptTokens: number;
  readonly replyTokens: number;
}

// a message as counted beside its call's billed reply: its role and content, a reply's thinking
// left out, which the reply's output holds
const countedOf = (message: TranscriptMessage): TranscriptMessage => {
  switch (message.role) {
    case "assistant": {
      return { content: message.content.filter((block) => !isThinking(block)), role: "assistant" };
    }
    case "user": {
      return { content: message.content, role: "user" };
    }
    case "system": {
      return { content: message.content, role: "system" };
    }
    // no default
  }
};

// What the cell is told of a call before it goes. Its prompt at most: the whole request counted,
// or, after a call the API answered under the same definition, that call's billed prompt and
// reply and the messages `added` after its prompt counted, the reply's own among them less its
// thinking, which its output holds, whichever is less: the API's own counts of the prompt and the
// reply make the second exact but for what was added and the reply's blocks around its words. The
// frozen system and tools, counted.
export const callEstimateOf = (
  definition: ThreadDefinition,
  request: BetaMessageStreamParams,
  anchor: CallAnchor | null,
  added: readonly TranscriptMessage[],
): CallEstimate => {
  const whole = tokensAtMost(JSON.stringify(request));
  return {
    frozenTokens:
      tokensAtMost(JSON.stringify(definition.system)) +
      tokensAtMost(JSON.stringify(definition.tools)),
    previous:
      anchor === null ? null : { endedAt: anchor.endedAt, promptTokens: anchor.promptTokens },
    promptTokens:
      anchor === null
        ? whole
        : Math.min(
            whole,
            anchor.promptTokens +
              anchor.replyTokens +
              tokensAtMost(JSON.stringify(added.map(countedOf))),
          ),
  };
};
