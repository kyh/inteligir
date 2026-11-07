// A Messages request as the fake reads it: parsed at the door into the blocks it knows, and
// refused, with the API's own words, for what Claude Opus 5.5 refuses before it samples
// (platform.claude.com/docs/en/api/messages, and the claude-api skill's Opus 5.5 migration notes):
// sampling parameters, thinking other than adaptive, a forced tool choice, a field on a message
// but its role and content, an assistant message last (a prefill), a system message out of place,
// a tool call with no result next, a result with no call before it, cache breakpoints past four
// or a 1-hour one after a 5-minute one, a breakpoint on a thinking block, a beta's field without
// its beta, and a compaction trigger other than input tokens or under 50,000. A conversation the
// API compacted is read from its last compaction block that kept a summary on, as the API reads it:
// everything before the block is ignored, and a block whose summary was not written, its content
// null, is ignored itself and compacts nothing
// (platform.claude.com/docs/en/build-with-claude/compaction-threshold).

import { z } from "zod";

// the betas whose fields a request may carry: the thinking-block binding control, server-side
// fallback on a refusal, threshold compaction, and progress notes between tool calls
export const BINDING_BETA = "thinking-binding-controls-2026-08-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const COMPACT_BETA = "compact-2026-01-12";
const DISPLAY_BETA = "thinking-display-updates-2026-08-18";

// the one compaction a request may ask for: at its threshold, on the server, which is input
// tokens alone, at least this many
const COMPACT_EDIT = "compact_20260112";
const COMPACT_TRIGGER_TYPE = "input_tokens";
const COMPACT_TRIGGER_LEAST = 50_000;

const cacheControlSchema = z.strictObject({
  ttl: z.enum(["5m", "1h"]).optional(),
  type: z.literal("ephemeral"),
});

const cached = { cache_control: cacheControlSchema.optional() };

const textSchema = z.looseObject({ ...cached, text: z.string(), type: z.literal("text") });

const blockSchema = z.discriminatedUnion("type", [
  textSchema,
  z.looseObject({
    ...cached,
    signature: z.string(),
    thinking: z.string(),
    type: z.literal("thinking"),
  }),
  z.looseObject({ ...cached, data: z.string(), type: z.literal("redacted_thinking") }),
  z.looseObject({
    ...cached,
    id: z.string(),
    input: z.json(),
    name: z.string(),
    type: z.literal("tool_use"),
  }),
  z.looseObject({
    ...cached,
    content: z.union([z.string(), z.array(textSchema)]).optional(),
    is_error: z.boolean().optional(),
    tool_use_id: z.string(),
    type: z.literal("tool_result"),
  }),
  z.looseObject({
    ...cached,
    from: z.looseObject({ model: z.string() }),
    to: z.looseObject({ model: z.string() }),
    trigger: z.json().optional(),
    type: z.literal("fallback"),
  }),
  z.looseObject({
    ...cached,
    content: z.string().nullable().optional(),
    encrypted_content: z.string().nullable().optional(),
    type: z.literal("compaction"),
  }),
]);

export type FakeBlock = z.infer<typeof blockSchema>;

const asText = (text: string): FakeBlock[] => [{ text, type: "text" }];

const contentSchema = z.union([z.string().transform(asText), z.array(blockSchema)]);

// a message is its role and content and nothing else: any other field is a 400
const messageSchema = z.strictObject({
  content: contentSchema,
  role: z.enum(["user", "assistant", "system"]),
});

type FakeMessage = z.infer<typeof messageSchema>;

const toolSchema = z.looseObject({
  ...cached,
  description: z.string().optional(),
  input_schema: z.json(),
  name: z.string(),
});

type FakeTool = z.infer<typeof toolSchema>;

export const requestSchema = z.looseObject({
  context_management: z
    .looseObject({
      edits: z.array(
        z.looseObject({
          trigger: z
            .strictObject({ type: z.literal(COMPACT_TRIGGER_TYPE), value: z.number().int() })
            .nullish(),
          type: z.string(),
        }),
      ),
    })
    .optional(),
  fallbacks: z.union([z.literal("default"), z.array(z.json())]).optional(),
  max_tokens: z.number().int().positive(),
  messages: z.array(messageSchema).min(1),
  model: z.string(),
  stream: z.boolean().optional(),
  system: z.union([z.string().transform(asText), z.array(textSchema)]).optional(),
  temperature: z.number().optional(),
  thinking: z
    .looseObject({
      block_binding: z
        .strictObject({ prefix_mismatch_behavior: z.enum(["error", "drop_block"]) })
        .optional(),
      display: z.enum(["summarized", "omitted", "updates"]).optional(),
      type: z.string(),
    })
    .optional(),
  tool_choice: z.looseObject({ type: z.string() }).optional(),
  tools: z.array(toolSchema).optional(),
  top_k: z.number().optional(),
  top_p: z.number().optional(),
});

export type FakeRequest = z.infer<typeof requestSchema>;

// whether the request asks the API to compact the conversation at its threshold
export const asksCompaction = (request: FakeRequest): boolean =>
  request.context_management?.edits.some((edit) => edit.type === COMPACT_EDIT) === true;

// where a block sits: messages[index].content[at]
export interface BlockAt {
  readonly index: number;
  readonly at: number;
}

// the last compaction block that kept a summary: what the API reads the conversation from,
// ignoring all before it; one whose content is null it ignores
export const anchorOf = (request: FakeRequest): BlockAt | null => {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const at = request.messages[index]?.content.findLastIndex(
      (block) => block.type === "compaction" && (block.content ?? null) !== null,
    );
    if (at !== undefined && at !== -1) {
      return { at, index };
    }
  }
  return null;
};

// whether a block comes before the conversation's last compaction block, which the API ignores
export const beforeAnchor = (anchor: BlockAt | null, position: BlockAt): boolean =>
  anchor !== null &&
  (position.index < anchor.index || (position.index === anchor.index && position.at < anchor.at));

// a parse failure in the API's words: the path to the field, then what is wrong with it
export const issueText = (error: z.ZodError): string => {
  const [issue] = error.issues;
  if (issue === undefined) {
    return "The request could not be read.";
  }
  const path = issue.path.join(".");
  if (issue.code === "unrecognized_keys") {
    return `${[path, ...issue.keys].filter((part) => part !== "").join(".")}: Extra inputs are not permitted`;
  }
  return `${path}: ${issue.message}`;
};

// every block in the order the API renders them: tools, then system, then each message's
export interface RenderedBlock {
  readonly json: string;
  readonly breakpoint: "5m" | "1h" | null;
  readonly thinking: boolean;
}

// a block as the API compares it and counts it, its breakpoint aside
const withoutBreakpoint = (block: FakeBlock | FakeTool) =>
  Object.fromEntries(Object.entries(block).filter(([key]) => key !== "cache_control"));

const breakpointOf = (block: FakeBlock | FakeTool): "5m" | "1h" | null =>
  block.cache_control === undefined ? null : (block.cache_control.ttl ?? "5m");

export const renderedBlocks = (request: FakeRequest): RenderedBlock[] => {
  const tools = (request.tools ?? []).map((tool) => ({
    breakpoint: breakpointOf(tool),
    json: JSON.stringify(withoutBreakpoint(tool)),
    thinking: false,
  }));
  const blocks = [
    ...(request.system ?? []),
    ...request.messages.flatMap((message) => message.content),
  ];
  return [
    ...tools,
    ...blocks.map((block) => ({
      breakpoint: breakpointOf(block),
      json: JSON.stringify(withoutBreakpoint(block)),
      thinking: block.type === "thinking" || block.type === "redacted_thinking",
    })),
  ];
};

// the blocks a replayed thinking block is not bound to: itself and its kind, and a fallback's
// boundary, which is never rendered into the prompt
const isBound = (block: FakeBlock): boolean =>
  block.type !== "thinking" && block.type !== "redacted_thinking" && block.type !== "fallback";

// blocks as the next request's parse reads them back, each object's keys in the order that parse
// gives them, so a block the fake made compares with the same block sent back: the fake compares
// what was sent as parsed JSON, never as bytes
export const asParsed = (blocks: readonly FakeBlock[]): FakeBlock[] =>
  z.array(blockSchema).parse(blocks);

// what a block at messages[index].content[at] is bound to: the system, the tools as a name-keyed
// set and every message before it from the conversation's last compaction block on, compared
// without breakpoints and without thinking blocks
export const prefixOf = (request: FakeRequest, position: BlockAt): string => {
  const anchor = anchorOf(request) ?? { at: 0, index: 0 };
  const tools = (request.tools ?? [])
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map(withoutBreakpoint);
  const messages = request.messages
    .slice(anchor.index, position.index + 1)
    .map((message, offset) => {
      const index = anchor.index + offset;
      const from = index === anchor.index ? anchor.at : 0;
      const to = index === position.index ? position.at : message.content.length;
      return {
        content: message.content.slice(from, to).filter(isBound).map(withoutBreakpoint),
        role: message.role,
      };
    });
  return JSON.stringify({ messages, system: (request.system ?? []).map(withoutBreakpoint), tools });
};

const toolUseIds = (message: FakeMessage | undefined): Set<string> =>
  new Set(
    (message?.role === "assistant" ? message.content : []).flatMap((block) =>
      block.type === "tool_use" ? [block.id] : [],
    ),
  );

const placementRefusal = (messages: readonly FakeMessage[]): string | null => {
  for (const [index, message] of messages.entries()) {
    const before = messages[index - 1];
    const after = messages[index + 1];
    if (message.role === "system") {
      if (before?.role !== "user" || (after !== undefined && after.role !== "assistant")) {
        return `messages.${String(index)}: a system message must follow a user message, and be the last message or come before an assistant message.`;
      }
      if (message.content.some((block) => block.type !== "text")) {
        return `messages.${String(index)}.content: a system message holds text alone.`;
      }
    }
    const asked = toolUseIds(message);
    if (asked.size > 0) {
      const answered = new Set<string>();
      for (const block of after?.role === "user" ? after.content : []) {
        if (block.type !== "tool_result") {
          break;
        }
        answered.add(block.tool_use_id);
      }
      const missing = [...asked].filter((id) => !answered.has(id));
      if (missing.length > 0) {
        return `messages.${String(index + 1)}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${missing.join(", ")}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`;
      }
    }
    if (message.role === "user") {
      const prior = toolUseIds(before);
      for (const [at, block] of message.content.entries()) {
        if (block.type === "tool_result" && !prior.has(block.tool_use_id)) {
          return `messages.${String(index)}.content.${String(at)}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${block.tool_use_id}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`;
        }
      }
    }
  }
  return null;
};

const breakpointRefusal = (request: FakeRequest): string | null => {
  const blocks = renderedBlocks(request);
  if (blocks.some((block) => block.thinking && block.breakpoint !== null)) {
    return "cache_control cannot be set on a thinking block.";
  }
  const marks = blocks.flatMap((block) => (block.breakpoint === null ? [] : [block.breakpoint]));
  if (marks.length > 4) {
    return `A maximum of 4 blocks with cache_control may be provided. Found ${String(marks.length)}.`;
  }
  const firstShort = marks.indexOf("5m");
  return firstShort !== -1 && marks.slice(firstShort).includes("1h")
    ? "a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block"
    : null;
};

// a field only a beta allows, sent without it, or a value it does not know
const betaRefusal = (request: FakeRequest, betas: ReadonlySet<string>): string | null => {
  if (request.thinking?.block_binding !== undefined && !betas.has(BINDING_BETA)) {
    return "thinking.block_binding: Extra inputs are not permitted";
  }
  if (request.thinking?.display === "updates" && !betas.has(DISPLAY_BETA)) {
    return 'thinking.display: "updates" is not a supported value.';
  }
  if (request.fallbacks !== undefined && !betas.has(FALLBACK_BETA)) {
    return "fallbacks: Extra inputs are not permitted";
  }
  if (request.context_management !== undefined && !betas.has(COMPACT_BETA)) {
    return "context_management: Extra inputs are not permitted";
  }
  for (const [index, edit] of (request.context_management?.edits ?? []).entries()) {
    const at = `context_management.edits.${String(index)}`;
    if (edit.type !== COMPACT_EDIT) {
      return `${at}: "${edit.type}" is not a supported edit.`;
    }
    if ((edit.trigger?.value ?? COMPACT_TRIGGER_LEAST) < COMPACT_TRIGGER_LEAST) {
      return `${at}.trigger.value: must be at least ${String(COMPACT_TRIGGER_LEAST)} tokens.`;
    }
  }
  return null;
};

// a conversation's ends: its first message the person's, or, compacted, the assistant message
// that holds its compaction block, and its last never the assistant's; a compaction block only
// ever the assistant's
const endsRefusal = (messages: readonly FakeMessage[]): string | null => {
  const stray = messages.findIndex(
    (message) =>
      message.role !== "assistant" && message.content.some((block) => block.type === "compaction"),
  );
  if (stray !== -1) {
    return `messages.${String(stray)}: a compaction block belongs in an assistant message.`;
  }
  const [first] = messages;
  if (first?.role !== "user" && first?.content[0]?.type !== "compaction") {
    return "messages.0.role: the first message must use the user role";
  }
  return messages.at(-1)?.role === "assistant"
    ? "This model does not support assistant message prefill. The conversation must end with a user message."
    : null;
};

// why the request is refused before any sampling, in the API's words, or null
export const requestRefusal = (request: FakeRequest, betas: ReadonlySet<string>): string | null => {
  for (const name of ["temperature", "top_p", "top_k"] as const) {
    if (request[name] !== undefined) {
      return `${name}: Extra inputs are not permitted`;
    }
  }
  if (request.thinking !== undefined && request.thinking.type !== "adaptive") {
    return `thinking.type: "${request.thinking.type}" is not supported for this model. Use "adaptive".`;
  }
  const forced = request.tool_choice?.type;
  if (forced === "any" || forced === "tool") {
    return 'tool_choice: type "tool" and "any" are not supported for this model.';
  }
  return (
    betaRefusal(request, betas) ??
    endsRefusal(request.messages) ??
    placementRefusal(request.messages) ??
    breakpointRefusal(request)
  );
};
