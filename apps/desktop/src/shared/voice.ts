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
  | { type: "voice:tts-chunk"; audio: string }; // base64 mp3

export type SttConfig = {
  languageCode: string;
  sampleRate: number;
  vadSilenceThresholdSecs: number;
  vadThreshold: number;
};

export const DEFAULT_STT_CONFIG: SttConfig = {
  languageCode: "en",
  sampleRate: 16000,
  vadSilenceThresholdSecs: 1.5,
  vadThreshold: 0.4,
};

export type VoiceSettings = {
  apiKey: string;
  voiceId: string;
  stt: SttConfig;
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

/** ElevenLabs "River" — relaxed, neutral, informative.
 *  Browse alternatives at https://elevenlabs.io/voice-library */
export const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
