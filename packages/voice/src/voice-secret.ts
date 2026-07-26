// ---------------------------------------------------------------------------
// Voice owns its secret: the ElevenLabs API key lives in the encrypted
// SecretStore under ELEVENLABS_API_KEY_UI_STATE, written HERE rather than
// routed through the generic ui-state store — a key-shaped special case
// inside a general store is how plaintext ends up in ui-state.json. ui-state
// keeps only the `true` presence marker Settings reads through getUiState
// ("is a key stored").
//
// Both sinks (secret + marker) are injected so this module is unit-testable;
// production passes the process singletons.
// ---------------------------------------------------------------------------

import { getSecretStore } from "@repo/storage/secrets";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";

/** The slice of SecretStore the voice key needs — injection seam for tests. */
export type VoiceSecretSink = {
  set: (key: string, value: string) => void;
  get: (key: string) => string | null;
  delete: (key: string) => void;
};

/** Where the `true` presence marker lands (ui-state) — always passed by the
 * caller: ui-state is a server store, and voice/ sits below the server, so
 * the voice handler binds the production sink at call time. */
export type VoiceMarkerSink = {
  set: (key: string, value: unknown) => void;
};

/**
 * Store or clear the ElevenLabs key. A non-empty string (trimmed) is stored
 * in the encrypted SecretStore with a `true` marker in ui-state; anything
 * else (undefined, empty, whitespace, wrong type) clears both — one write
 * path, so the secret and its marker can never disagree.
 */
export function setVoiceApiKey(
  value: unknown,
  marker: VoiceMarkerSink,
  secrets: VoiceSecretSink = getSecretStore(),
): void {
  const secret = typeof value === "string" ? value.trim() : "";
  if (secret.length > 0) {
    secrets.set(ELEVENLABS_API_KEY_UI_STATE, secret);
    marker.set(ELEVENLABS_API_KEY_UI_STATE, true); // presence only — plaintext stays out
    return;
  }
  secrets.delete(ELEVENLABS_API_KEY_UI_STATE);
  marker.set(ELEVENLABS_API_KEY_UI_STATE, undefined);
}

/** Decrypted key, or null when none is stored. */
export function getVoiceApiKey(secrets: VoiceSecretSink = getSecretStore()): string | null {
  return secrets.get(ELEVENLABS_API_KEY_UI_STATE);
}
