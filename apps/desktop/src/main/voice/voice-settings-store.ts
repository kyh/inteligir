// ---------------------------------------------------------------------------
// Voice settings persistence — uses Electron safeStorage for the API key
// ---------------------------------------------------------------------------

import { safeStorage } from "electron";
import { z } from "zod";

import { inteligirPath, readJson, writeJson } from "@/main/lib/json-store";
import { DEFAULT_STT_CONFIG, DEFAULT_VOICE_ID, type VoiceSettings } from "@/shared/voice";

const VOICE_SETTINGS_PATH = inteligirPath("voice-settings.json");

const SttConfigSchema = z.object({
  languageCode: z.string().default(DEFAULT_STT_CONFIG.languageCode),
  sampleRate: z.number().default(DEFAULT_STT_CONFIG.sampleRate),
  vadSilenceThresholdSecs: z.number().default(DEFAULT_STT_CONFIG.vadSilenceThresholdSecs),
  vadThreshold: z.number().default(DEFAULT_STT_CONFIG.vadThreshold),
});

// On-disk schema: storedApiKey is encrypted (base64) when safeStorage is available, plaintext otherwise
const DiskSchema = z.object({
  storedApiKey: z.string().min(1),
  voiceId: z.string().default(DEFAULT_VOICE_ID),
  stt: SttConfigSchema.default(DEFAULT_STT_CONFIG),
});

// IPC input schema for setVoiceSettings
const VoiceSettingsSchema = z.object({
  apiKey: z.string().min(1),
  voiceId: z.string(),
});

export function getVoiceSettings(): VoiceSettings | null {
  const disk = readJson(VOICE_SETTINGS_PATH, DiskSchema);
  if (!disk) return null;

  try {
    const apiKey = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(disk.storedApiKey, "base64"))
      : disk.storedApiKey;
    if (!apiKey) return null;
    return { apiKey, voiceId: disk.voiceId, stt: disk.stt };
  } catch (err) {
    console.error("[voice-settings] failed to decrypt API key:", err);
    return null;
  }
}

export function setVoiceSettings(raw: unknown): void {
  const settings = VoiceSettingsSchema.parse(raw);

  let storedApiKey: string;
  if (safeStorage.isEncryptionAvailable()) {
    storedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
  } else {
    console.warn(
      "[voice-settings] OS keychain not available — API key will be stored in plaintext. " +
      "On Linux, install a keyring (e.g. gnome-keyring) for encrypted storage.",
    );
    storedApiKey = settings.apiKey;
  }

  // Preserve existing STT config on disk (not settable via UI yet)
  const existing = readJson(VOICE_SETTINGS_PATH, DiskSchema);

  writeJson(VOICE_SETTINGS_PATH, {
    storedApiKey,
    voiceId: settings.voiceId || DEFAULT_VOICE_ID,
    stt: existing?.stt ?? DEFAULT_STT_CONFIG,
  });
}
