import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const DispatchDirectionSchema = Type.Union([
  Type.Literal("to_device"),
  Type.Literal("to_mobile"),
]);
export type DispatchDirection = Static<typeof DispatchDirectionSchema>;

export const MobileCommandTypeSchema = Type.Union([
  Type.Literal("user_message"),
  Type.Literal("steer"),
  Type.Literal("interrupt"),
]);
export type MobileCommandType = Static<typeof MobileCommandTypeSchema>;

export const AgentEventTypeSchema = Type.Union([
  Type.Literal("agent_start"),
  Type.Literal("agent_end"),
  Type.Literal("message_start"),
  Type.Literal("message_update"),
  Type.Literal("message_end"),
  Type.Literal("tool_execution_start"),
  Type.Literal("tool_execution_end"),
]);
export type AgentEventType = Static<typeof AgentEventTypeSchema>;

export const EPHEMERAL_EVENT_TYPES = new Set<string>([
  "message_update",
  "message_start",
]);

export const DispatchEnvelopeSchema = Type.Object({
  direction: DispatchDirectionSchema,
  type: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});
export type DispatchEnvelope = Static<typeof DispatchEnvelopeSchema>;

export function parseMessage(data: string): DispatchEnvelope | null {
  try {
    const parsed = JSON.parse(data);
    if (Value.Check(DispatchEnvelopeSchema, parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeMessage(
  direction: DispatchDirection,
  type: string,
  payload: Record<string, unknown> = {},
): string {
  return JSON.stringify({ direction, type, payload });
}

// ---------------------------------------------------------------------------
// Chat bridge — external messaging interfaces (Slack/Telegram/WhatsApp/Discord)
// relayed through the same party room as the mobile relay.
//
// A public "gateway" (the Chat SDK webhook handlers in @repo/web) receives a
// platform message, POSTs it into the room as a `chat_message` (to_device),
// and blocks until the desktop answers with a `chat_reply` (to_mobile) carrying
// the same `correlationId`. The desktop runs the agent for one turn and replies
// with the assistant's text. Unlike the streaming `agent_event` relay, the chat
// bridge is request/response: one inbound message, one consolidated reply.
// ---------------------------------------------------------------------------

export const CHAT_MESSAGE_TYPE = "chat_message";
export const CHAT_REPLY_TYPE = "chat_reply";
/** Sent by the desktop on connect so the relay knows which WebSocket is a real
 * agent host. Without it the room can't tell a desktop from a paired mobile
 * client and would relay chat messages to a peer that can't answer. */
export const CHAT_DEVICE_REGISTER_TYPE = "chat_device_register";

/** Where a chat message originated. Used for logging/routing on the desktop;
 * the gateway posts the reply back through the live thread handle it already
 * holds, so these fields are informational rather than load-bearing. */
export const ChatConversationSchema = Type.Object({
  /** Adapter name: "slack" | "telegram" | "whatsapp" | "discord". */
  platform: Type.String(),
  channelId: Type.Optional(Type.String()),
  threadId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  userName: Type.Optional(Type.String()),
  isDM: Type.Optional(Type.Boolean()),
});
export type ChatConversation = Static<typeof ChatConversationSchema>;

export const ChatMessagePayloadSchema = Type.Object({
  correlationId: Type.String(),
  text: Type.String(),
  conversation: Type.Optional(ChatConversationSchema),
});
export type ChatMessagePayload = Static<typeof ChatMessagePayloadSchema>;

export const ChatReplyPayloadSchema = Type.Object({
  correlationId: Type.String(),
  text: Type.String(),
});
export type ChatReplyPayload = Static<typeof ChatReplyPayloadSchema>;

export function parseChatMessage(payload: unknown): ChatMessagePayload | null {
  return Value.Check(ChatMessagePayloadSchema, payload) ? payload : null;
}

export function parseChatReply(payload: unknown): ChatReplyPayload | null {
  return Value.Check(ChatReplyPayloadSchema, payload) ? payload : null;
}
