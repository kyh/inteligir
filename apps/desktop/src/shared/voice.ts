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

export const DEFAULT_VOICE_ID = "HpyxY047iEZzSG1aUPfx";
