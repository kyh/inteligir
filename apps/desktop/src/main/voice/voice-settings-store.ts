// ---------------------------------------------------------------------------
// Voice settings persistence — ~/.inteligir/voice-settings.json
// ---------------------------------------------------------------------------

import { z } from "zod";

import { inteligirPath, readJson, writeJson } from "@/main/lib/json-store";
import { DEFAULT_VOICE_ID, type VoiceSettings } from "@/shared/voice";

const VOICE_SETTINGS_PATH = inteligirPath("voice-settings.json");

const VoiceSettingsSchema = z.object({
  apiKey: z.string().min(1),
  voiceId: z.string().default(DEFAULT_VOICE_ID),
});

export function getVoiceSettings(): VoiceSettings | null {
  return readJson(VOICE_SETTINGS_PATH, VoiceSettingsSchema);
}

export function setVoiceSettings(settings: VoiceSettings): void {
  writeJson(VOICE_SETTINGS_PATH, VoiceSettingsSchema.parse(settings));
}
