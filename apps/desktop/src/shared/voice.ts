// ---------------------------------------------------------------------------
// Voice conversation types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

export type VoiceSessionState =
  | "inactive"
  | "starting"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export type VoiceEvent =
  | { type: "voice:state"; state: VoiceSessionState; error?: string }
  | { type: "voice:transcript"; text: string; isFinal: boolean }
  | { type: "voice:tts-chunk"; audio: string } // base64 mp3
  | { type: "voice:tts-done" };

export type VoiceSettings = {
  apiKey: string;
  voiceId: string; // default: "HpyxY047iEZzSG1aUPfx" (Samantha)
};

/** Masked settings returned to the renderer — never exposes the full API key. */
export type VoiceSettingsDisplay = {
  apiKeyMasked: string; // e.g. "sk-...xxxx"
  voiceId: string;
};

/** Returned by getVoiceSettings IPC — includes encryption status for UI warnings. */
export type VoiceSettingsResponse = {
  settings: VoiceSettingsDisplay | null;
  encryptionAvailable: boolean;
};

/** ElevenLabs "Samantha" voice — warm, breathy, conversational.
 *  Browse alternatives at https://elevenlabs.io/voice-library */
export const DEFAULT_VOICE_ID = "HpyxY047iEZzSG1aUPfx";
