// Voice owns its secret: the ElevenLabs key goes into the SecretStore
// directly, with only a `true` presence marker in ui-state. These pin that
// split — plaintext must never reach the marker sink.

import { describe, expect, it } from "vitest";

import { getVoiceApiKey, setVoiceApiKey, type VoiceSecretSink } from "../voice-secret";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";

type FakeSink = VoiceSecretSink & { values: Map<string, string> };

function fakeSecrets(): FakeSink {
  const values = new Map<string, string>();
  return {
    values,
    set: (key, value) => {
      values.set(key, value);
    },
    get: (key) => values.get(key) ?? null,
    delete: (key) => {
      values.delete(key);
    },
  };
}

function fakeMarker(): { values: Map<string, unknown>; set: (key: string, v: unknown) => void } {
  const values = new Map<string, unknown>();
  return {
    values,
    set: (key, value) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
  };
}

describe("setVoiceApiKey", () => {
  it("stores the trimmed key in the secret sink and marks presence `true`", () => {
    const secrets = fakeSecrets();
    const marker = fakeMarker();

    setVoiceApiKey("  sk-elevenlabs-123  ", marker, secrets);

    expect(secrets.values.get(ELEVENLABS_API_KEY_UI_STATE)).toBe("sk-elevenlabs-123");
    expect(marker.values.get(ELEVENLABS_API_KEY_UI_STATE)).toBe(true); // never the plaintext
  });

  it("clears the secret and the marker on undefined", () => {
    const secrets = fakeSecrets();
    const marker = fakeMarker();
    setVoiceApiKey("sk-1", marker, secrets);

    setVoiceApiKey(undefined, marker, secrets);

    expect(secrets.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
    expect(marker.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
  });

  it("treats an empty/whitespace/non-string value as removal", () => {
    const secrets = fakeSecrets();
    const marker = fakeMarker();
    setVoiceApiKey("sk-1", marker, secrets);

    setVoiceApiKey("   ", marker, secrets);

    expect(secrets.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
    expect(marker.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
  });
});

describe("getVoiceApiKey", () => {
  it("reads the stored key back; null when none", () => {
    const secrets = fakeSecrets();
    expect(getVoiceApiKey(secrets)).toBeNull();

    setVoiceApiKey("sk-1", fakeMarker(), secrets);

    expect(getVoiceApiKey(secrets)).toBe("sk-1");
  });
});
