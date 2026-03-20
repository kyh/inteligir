// ---------------------------------------------------------------------------
// Voice session types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

export type VoiceSessionState =
  | "inactive"
  | "connecting"
  | "connected"
  | "error";

/** Data channel topic for text chat between renderer and agent worker. */
export const TEXT_CHAT_TOPIC = "inteligir:chat";

/** Messages sent over the data channel between renderer and agent worker. */
export type TextChatMessage =
  | { type: "user_message"; text: string }
  | { type: "steer"; text: string }
  | { type: "interrupt" }
  | { type: "clear" };
