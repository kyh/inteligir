// One request of a conversation, built from the thread's frozen definition and its transcript:
// Claude Opus 5.5 at effort medium (`./library-agent`), adaptive thinking whose replayed blocks
// are dropped rather than refused when they fail the conversation check, and a refusal answered by
// the fallback model Anthropic names for its category inside the same call
// (platform.claude.com/docs/en/build-with-claude/refusals-and-fallback). The system and the tools
// are those the thread started with, byte for byte, each closed by a 1-hour cache breakpoint, so
// every conversation of every account reads one cached prefix; the last block of the last message
// carries a 5-minute one on a copy, so each step reads the steps before it. A message is its role
// and content alone, never an assistant's last: a replayed thinking block is checked against
// everything before it, and a field the API does not expect is a 400. No tool choice, no sampling,
// no eager input streaming. A drop is a bug, so every one is logged.

import type {
  BetaCacheControlEphemeral,
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import { AGENT_SYSTEM_PROMPT } from "./agent-prompt";
import { AGENT_TOOL_DEFINITIONS } from "./agent-tools";
import { AGENT_MODEL } from "./library-agent";

// the thinking-block binding control, and server-side fallback on a refusal
export const AGENT_BETAS = [
  "thinking-binding-controls-2026-08-01",
  "server-side-fallback-2026-07-01",
] as const;

const HOUR_CACHE = { ttl: "1h", type: "ephemeral" } as const;
const ROLLING_CACHE = { type: "ephemeral" } as const;

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

const JSON_TEXT = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

const userContent = z.array(userBlockSchema).min(1);
const replyContent = z.array(replyBlockSchema).min(1);
const systemContent = z.array(textSchema).min(1);

// each holds the value as it is, its keys in the order they were written, which a parse would not
const isUserContent = (value: unknown): value is UserBlock[] =>
  userContent.safeParse(value).success;
const isReplyContent = (value: unknown): value is ReplyBlock[] =>
  replyContent.safeParse(value).success;
const isSystemContent = (value: unknown): value is TextBlock[] =>
  systemContent.safeParse(value).success;

// a stored row as the message it replays: the content exactly as it was written
export const transcriptMessage = (role: string, content: string): TranscriptMessage => {
  const value: unknown = JSON.parse(content);
  if (role === "user" && isUserContent(value)) {
    return { content: value, role };
  }
  if (role === "assistant" && isReplyContent(value)) {
    return { content: value, role };
  }
  if (role === "system" && isSystemContent(value)) {
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
  return isReplyContent(blocks) ? [...blocks] : null;
};

// ---- the definition ----

export interface ThreadDefinition {
  readonly system: readonly BetaTextBlockParam[];
  readonly tools: readonly BetaTool[];
}

const toolSchema = z.looseObject({
  description: z.string().optional(),
  input_schema: z.looseObject({ type: z.literal("object") }),
  name: z.string(),
});

// a definition row as the thread froze it
export const storedDefinition = (row: {
  readonly system: string;
  readonly tools: string;
}): ThreadDefinition => ({
  system: z.array(textSchema).min(1).parse(JSON_TEXT.parse(row.system)),
  tools: z.array(toolSchema).parse(JSON_TEXT.parse(row.tools)),
});

// what this deployment would freeze a thread with: the prompt and the tools as they stand
export const deployedDefinition = (): ThreadDefinition => ({
  system: [{ text: AGENT_SYSTEM_PROMPT, type: "text" }],
  tools: AGENT_TOOL_DEFINITIONS,
});

// ---- the request ----

// a copy of the last entry carrying `cache_control`, the stored ones left alone
const closedBy = <T extends object>(entries: readonly T[], cache: BetaCacheControlEphemeral): T[] =>
  entries.map((entry, index) =>
    index === entries.length - 1 ? { ...entry, cache_control: cache } : entry,
  );

const isThinking = (block: { readonly type: string }): boolean =>
  block.type === "thinking" || block.type === "redacted_thinking";

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

export const agentRequest = (
  definition: ThreadDefinition,
  transcript: readonly TranscriptMessage[],
  maxTokens: number,
): BetaMessageStreamParams => ({
  betas: [...AGENT_BETAS],
  fallbacks: "default",
  max_tokens: maxTokens,
  messages: transcript.map((message, index) =>
    messageParam(message, index === transcript.length - 1),
  ),
  model: AGENT_MODEL.id,
  output_config: { effort: AGENT_MODEL.effort },
  system: closedBy(definition.system, HOUR_CACHE),
  thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" }, type: "adaptive" },
  tools: closedBy(definition.tools, HOUR_CACHE),
});

// every replayed thinking block the API dropped, logged by where it sat: a fallback model reads
// none of Opus 5.5's, which is no bug, and every other drop is one
export const logDroppedThinking = (threadId: string, message: BetaMessage): number => {
  let dropped = 0;
  for (const entry of message.input_transformations ?? []) {
    if (entry.type === "thinking_dropped" && entry.reason !== "model_binding_mismatch") {
      dropped += 1;
      console.error({
        event: "agent-thinking-dropped",
        path: entry.path,
        reason: entry.reason,
        threadId,
      });
    }
  }
  return dropped;
};

// ---- what a body costs to send, as the cell prices a reservation ----

// tokens are fewer than a third of a body's characters, so this overestimates on purpose
export const tokensAtMost = (chars: number): number => Math.ceil(chars / 3);
