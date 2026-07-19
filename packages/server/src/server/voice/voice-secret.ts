// ---------------------------------------------------------------------------
// Voice owns its secret (restructure step 2): the ElevenLabs API key lives in
// the encrypted SecretStore under ELEVENLABS_API_KEY_UI_STATE, written HERE —
// not routed through the generic ui-state store, which used to special-case
// this one key. ui-state keeps only the `true` presence marker Settings reads
// through getUiState ("is a key stored"), so the renderer surface is
// unchanged: same secrets.json entry, same ui-state.json marker.
//
// Injection seams (secret sink + marker sink) mirror the old UiStateManager
// test seam; production uses the process singletons.
// ---------------------------------------------------------------------------

import { getSecretStore } from "@repo/storage/secrets";
import { getUiState } from "../ui-state";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";

/** The slice of SecretStore the voice key needs — injection seam for tests. */
export type VoiceSecretSink = {
  set: (key: string, value: string) => void;
  get: (key: string) => string | null;
  delete: (key: string) => void;
};

/** Where the `true` presence marker lands (ui-state) — seam for tests. */
export type VoiceMarkerSink = {
  set: (key: string, value: unknown) => void;
};

/**
 * Store or clear the ElevenLabs key. A non-empty string (trimmed) is stored
 * in the encrypted SecretStore with a `true` marker in ui-state; anything
 * else (undefined, empty, whitespace, wrong type) clears both — matching the
 * old setUiState routing byte-for-byte.
 */
export function setVoiceApiKey(
  value: unknown,
  secrets: VoiceSecretSink = getSecretStore(),
  marker: VoiceMarkerSink = getUiState(),
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
