// ---------------------------------------------------------------------------
// Voice settings persistence — uses Electron safeStorage for the API key
// ---------------------------------------------------------------------------

import { safeStorage } from "electron";
import { z } from "zod";

import { inteligirPath, readJson, writeJson } from "@/main/lib/json-store";
import { DEFAULT_VOICE_ID, type VoiceSettings } from "@/shared/voice";

const VOICE_SETTINGS_PATH = inteligirPath("voice-settings.json");

// On-disk schema: apiKey is encrypted via safeStorage, stored as base64
const DiskSchema = z.object({
  encryptedApiKey: z.string().min(1),
  voiceId: z.string().default(DEFAULT_VOICE_ID),
});

export function getVoiceSettings(): VoiceSettings | null {
  const disk = readJson(VOICE_SETTINGS_PATH, DiskSchema);
  if (!disk) return null;

  try {
    const apiKey = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(disk.encryptedApiKey, "base64"))
      : disk.encryptedApiKey;
    if (!apiKey) return null;
    return { apiKey, voiceId: disk.voiceId };
  } catch (err) {
    console.error("[voice-settings] failed to decrypt API key:", err);
    return null;
  }
}

export function setVoiceSettings(settings: VoiceSettings): void {
  // Validate shape strictly on the main-process side
  if (
    typeof settings !== "object" ||
    settings === null ||
    typeof settings.apiKey !== "string" ||
    typeof settings.voiceId !== "string" ||
    settings.apiKey.length === 0
  ) {
    throw new Error("Invalid voice settings");
  }

  let encryptedApiKey: string;
  if (safeStorage.isEncryptionAvailable()) {
    encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString("base64");
  } else {
    console.warn(
      "[voice-settings] OS keychain not available — API key will be stored in plaintext. " +
      "On Linux, install a keyring (e.g. gnome-keyring) for encrypted storage.",
    );
    encryptedApiKey = settings.apiKey;
  }

  writeJson(VOICE_SETTINGS_PATH, {
    encryptedApiKey,
    voiceId: settings.voiceId || DEFAULT_VOICE_ID,
  });
}
