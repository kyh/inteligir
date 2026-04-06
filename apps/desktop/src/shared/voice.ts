// ---------------------------------------------------------------------------
// Voice session types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { z } from "zod";

export type VoiceSessionState =
  | "inactive"
  | "connecting"
  | "connected"
  | "error";

/** Messages sent between renderer and agent worker via IPC. */
export const TextChatMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_message"), text: z.string() }),
  z.object({ type: z.literal("steer"), text: z.string() }),
  z.object({ type: z.literal("interrupt") }),
]);

export type TextChatMessage = z.infer<typeof TextChatMessageSchema>;

// ---------------------------------------------------------------------------
// VoiceSession events — emitted by the session class, consumed by stores
// ---------------------------------------------------------------------------

export type VoiceSessionEvent =
  | { type: "state_changed"; state: VoiceSessionState; error?: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
  | { type: "audio_track_subscribed"; track: unknown }
  | { type: "audio_track_unsubscribed"; track: unknown };
