// ---------------------------------------------------------------------------
// Voice constants shared between host <-> renderer. Voice-adjacent chat wire
// types live in ./chat-message; this module holds only the voice half.
// ---------------------------------------------------------------------------

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
