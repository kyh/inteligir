// ---------------------------------------------------------------------------
// Voice pipeline — orchestrates Deepgram STT + ElevenLabs TTS + agent IPC
// ---------------------------------------------------------------------------

import { startSTT, type STTHandle } from "./stt";
import { createTTS, type TTSHandle } from "./tts";
import type { VoiceSessionState } from "@/shared/voice";

export type VoicePipelineEvent =
  | { type: "state_changed"; state: VoiceSessionState; error?: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string };

export type VoicePipelineListener = (event: VoicePipelineEvent) => void;

export type VoicePipelineConfig = {
  deepgramApiKey: string;
  elevenlabsApiKey: string;
  elevenlabsVoiceId?: string;
};

export class VoicePipeline {
  private stt: STTHandle | null = null;
  private tts: TTSHandle | null = null;
  private state: VoiceSessionState = "inactive";
  private readonly listeners = new Set<VoicePipelineListener>();

  constructor(private readonly config: VoicePipelineConfig) {}

  on(listener: VoicePipelineListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): VoiceSessionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");

    try {
      // Start TTS first (WebSocket connect)
      this.tts = createTTS(
        this.config.elevenlabsApiKey,
        this.config.elevenlabsVoiceId,
      );

      // Start STT (requests mic permission + opens Deepgram WebSocket)
      this.stt = await startSTT(
        this.config.deepgramApiKey,
        (text, isFinal) => {
          if (isFinal) {
            this.emit({ type: "transcript_partial", text: "" });
            if (text.trim()) {
              this.emit({ type: "transcript_final", text: text.trim() });
            }
          } else {
            this.emit({ type: "transcript_partial", text });
          }
        },
        () => {
          // User started speaking — interrupt any ongoing TTS playback
          this.tts?.interrupt();
        },
        (error) => {
          console.error("[voice] STT error:", error);
          this.disconnect();
          this.setState("error", error);
        },
      );

      this.setState("connected");
    } catch (err) {
      this.disconnect();
      this.setState("error", err instanceof Error ? err.message : String(err));
    }
  }

  disconnect(): void {
    this.stt?.stop();
    this.stt = null;
    this.tts?.close();
    this.tts = null;
    this.setState("inactive");
  }

  /** Stream agent response text to TTS for speech synthesis. */
  speakText(text: string): void {
    this.tts?.sendText(text);
  }

  /** Signal end of agent response — flushes remaining TTS audio. */
  flushSpeech(): void {
    this.tts?.flush();
  }

  /** Interrupt current TTS playback (e.g., user started speaking). */
  interruptSpeech(): void {
    this.tts?.interrupt();
  }

  private setState(state: VoiceSessionState, error?: string): void {
    this.state = state;
    this.emit({ type: "state_changed", state, error });
  }

  private emit(event: VoicePipelineEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* listener error */ }
    }
  }
}
