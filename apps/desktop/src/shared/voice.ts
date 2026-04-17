// ---------------------------------------------------------------------------
// Voice types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { z } from "zod";

export type VoiceSessionState =
  | "inactive"
  | "connecting"
  | "connected"
  | "error";

/** Messages sent between renderer and agent via IPC. */
export const TextChatMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_message"), text: z.string() }),
  z.object({ type: z.literal("steer"), text: z.string() }),
  z.object({ type: z.literal("interrupt") }),
]);

export type TextChatMessage = z.infer<typeof TextChatMessageSchema>;
