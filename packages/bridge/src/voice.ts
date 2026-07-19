// ---------------------------------------------------------------------------
// Voice types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

/**
 * The key the user's ElevenLabs API key is stored under. Written by the
 * Settings panel via the voice-owned setVoiceApiKey channel; the host
 * (@repo/voice/voice-secret.ts) puts the plaintext in the encrypted
 * SecretStore (~/.inteligir/secrets.json) and keeps only a `true` presence
 * marker under this same key in ui-state.json, which is what getUiState
 * exposes to the renderer. The TTS proxy reads the secret through its
 * injected getApiKey source. The ELEVENLABS_API_KEY env var remains a
 * dev-only fallback — packaged builds launched from Finder/Dock inherit no
 * shell env, so this persisted entry is the only configuration path for
 * real users.
 */
export const ELEVENLABS_API_KEY_UI_STATE = "voice.elevenLabsApiKey";

// Image attachments — base64 data + mime, matches pi-ai's ImageContent shape.
const ImageAttachmentSchema = Type.Object(
  {
    data: Type.String({ minLength: 1 }),
    mimeType: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ImageAttachment = Static<typeof ImageAttachmentSchema>;

const TextWithImagesObject = {
  text: Type.String(),
  images: Type.Optional(Type.Array(ImageAttachmentSchema)),
};

/** Messages sent between renderer and agent via IPC. */
export const TextChatMessageSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("user_message"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("steer"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("follow_up"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("interrupt") }, { additionalProperties: false }),
]);

export type TextChatMessage = Static<typeof TextChatMessageSchema>;
