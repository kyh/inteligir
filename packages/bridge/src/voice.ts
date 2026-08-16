// ---------------------------------------------------------------------------
// Voice — the TTS/STT wire vocabulary and the one shared ui-state key.
// Voice-adjacent chat wire types live in ./chat-message; this module holds only
// the voice half.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

/**
 * The key the user's ElevenLabs API key is stored under. Written by the
 * Settings panel via the voice-owned setVoiceApiKey channel; the host
 * puts the plaintext in the host's encrypted secret store and keeps only a
 * `true` presence
 * marker under this same key in ui-state.json, which is what getUiState
 * exposes to a client. The TTS proxy reads the secret through its
 * injected getApiKey source. The ELEVENLABS_API_KEY env var remains a
 * dev-only fallback — packaged builds launched from Finder/Dock inherit no
 * shell env, so this persisted entry is the only configuration path for
 * real users.
 */
export const ELEVENLABS_API_KEY_UI_STATE = "voice.elevenLabsApiKey";

export const TtsSendSchema = Type.Object({ text: Type.String() }, { additionalProperties: false });

/** setVoiceApiKey payload: a non-empty `value` stores the key; anything else
 * (absent, empty, whitespace) clears it. */
export const VoiceApiKeySchema = Type.Object(
  { value: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

// Float32Array / ArrayBuffer / ArrayBufferView don't have a TypeBox primitive;
// approximate with Type.Unknown plus a runtime narrow at the handler.
// UNKNOWN, never Any: both emit the same `{}` schema (so the wire format and
// Value.Check behaviour are identical), but Any would put a real `any` into
// the derived Bridge type — silently exempting every caller and every handler
// of this channel from the repo's no-explicit-any rule. `unknown` forces the
// host to narrow, which is where the ArrayBuffer/view check actually belongs:
// the binary transport hands the handler a standalone ArrayBuffer, but the
// same registry entry is also reachable over a JSON `send` frame carrying
// arbitrary JSON, so the shape must be proven rather than assumed.
export const BinaryAudioSchema = Type.Unknown();
