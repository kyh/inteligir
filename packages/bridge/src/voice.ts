// ---------------------------------------------------------------------------
// Voice constants shared between host <-> renderer. The chat-message wire
// types that used to live beside them moved to ./chat-message when the voice
// stack was cut; this file returned with TTS and holds only the voice half.
// ---------------------------------------------------------------------------

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
