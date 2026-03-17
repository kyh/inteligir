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

/** Returned by getVoiceSettings IPC — includes encryption status for UI warnings. */
export type VoiceSettingsResponse = {
  settings: VoiceSettings | null;
  encryptionAvailable: boolean;
};

/** ElevenLabs "Samantha" voice — warm, breathy, conversational.
 *  Browse alternatives at https://elevenlabs.io/voice-library */
export const DEFAULT_VOICE_ID = "HpyxY047iEZzSG1aUPfx";
