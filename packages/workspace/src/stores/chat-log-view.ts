import type { DynamicToolUIPart, TextUIPart, UIMessage } from "ai";

import type { ChatItem, ChatItemDetail, ChatLog } from "@repo/bridge/chat-log";

// ---------------------------------------------------------------------------
// The desktop VIEW over the shared chat log (@repo/bridge/chat-log): the
// fold itself is platform-neutral; this module projects its items into the AI
// SDK UIMessage shape the renderer components consume. Each message carries a
// single content part: user/assistant turns hold a TextUIPart; tool rows hold
// a DynamicToolUIPart whose state mirrors the agent's run-time status. The
// "steer" UX concept (a steering nudge sent mid-turn) rides on a user-role
// message via metadata.steer so the renderer can style it differently without
// inventing a new role outside the SDK shape.
// ---------------------------------------------------------------------------

export type ChatMessageMetadata = {
  steer?: boolean;
  imageCount?: number;
  /** When set, the bubble is styled as a turn-failure surface (red border,
   * "error" copy) and may show an action button based on the kind:
   *   - "auth": inline Re-authenticate link (likely auth/credentials issue)
   *   - "unknown": just the error text (pi-reported error of unspecified cause)
   * The text content is the human-readable error message. */
  errorKind?: "auth" | "unknown";
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;

/**
 * The messages of the CURRENT turn: everything after the last non-steer user
 * message (steer nudges ride mid-turn and don't reset the boundary). This is
 * the one place the turn-boundary rule lives — every consumer that asks "what
 * is the agent doing right now" (thinking flag, activity label) derives from
 * this slice instead of re-walking with its own copy of the steer exception.
 */
export function currentTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user" && !msg.metadata?.steer) return messages.slice(i + 1);
  }
  return messages;
}

function textPart(text: string, state?: TextUIPart["state"]): TextUIPart {
  return state ? { type: "text", text, state } : { type: "text", text };
}

function toolPart(
  item: Extract<ChatItem, { kind: "tool" }>,
  d: ChatItemDetail | undefined,
): DynamicToolUIPart {
  // The reducer records a tool detail whenever it creates a tool row — the
  // fallback only guards a malformed log.
  const tool = d?.kind === "tool" ? d : { toolCallId: item.id, args: undefined, resultText: null };
  switch (item.state) {
    case "running":
      return {
        type: "dynamic-tool",
        toolCallId: tool.toolCallId,
        toolName: item.toolName,
        state: "input-available",
        input: tool.args,
      };
    case "done":
      return {
        type: "dynamic-tool",
        toolCallId: tool.toolCallId,
        toolName: item.toolName,
        state: "output-available",
        input: tool.args,
        output: tool.resultText ?? "",
      };
    case "error":
      return {
        type: "dynamic-tool",
        toolCallId: tool.toolCallId,
        toolName: item.toolName,
        state: "output-error",
        input: tool.args,
        errorText: tool.resultText ?? "",
      };
  }
}

function buildMessage(
  item: ChatItem,
  detail: ReadonlyMap<string, ChatItemDetail>,
  meta: ReadonlyMap<string, ChatMessageMetadata>,
): ChatMessage {
  const itemMeta = meta.get(item.id);
  switch (item.kind) {
    case "user":
      return {
        id: item.id,
        role: "user",
        parts: [textPart(item.text)],
        ...(itemMeta ? { metadata: itemMeta } : {}),
      };
    case "assistant": {
      // An error item without a recorded kind (message_end error, undelivered
      // send) is cause-unknown — don't claim it's auth.
      const d = detail.get(item.id);
      const metadata: ChatMessageMetadata | undefined = item.isError
        ? { ...itemMeta, errorKind: d?.kind === "error" ? d.errorKind : "unknown" }
        : itemMeta;
      return {
        id: item.id,
        role: "assistant",
        parts: [textPart(item.text, item.streaming ? "streaming" : undefined)],
        ...(metadata ? { metadata } : {}),
      };
    }
    case "tool":
      return {
        id: item.id,
        role: "assistant",
        parts: [toolPart(item, detail.get(item.id))],
      };
  }
}

// Cache keyed by ITEM OBJECT identity. Sound because an item's detail and
// meta are fixed at creation (the reducer replaces the item object on every
// mutation, and chatMeta entries are written once, when the item is
// appended) — so a given item object always projects to the same message.
const projected = new WeakMap<ChatItem, ChatMessage>();

/**
 * Project the shared log into UIMessages. Identity-stable: untouched items
 * reuse their previous message object, so while a reply streams (a new log
 * per delta) only the streaming row's message is rebuilt — bottom-composer's
 * memoized rows depend on this.
 */
export function projectChatLog(
  log: ChatLog,
  meta: ReadonlyMap<string, ChatMessageMetadata>,
): ChatMessage[] {
  return log.items.map((item) => {
    const hit = projected.get(item);
    if (hit !== undefined) return hit;
    const built = buildMessage(item, log.detail, meta);
    projected.set(item, built);
    return built;
  });
}
