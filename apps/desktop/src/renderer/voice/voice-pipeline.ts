// ---------------------------------------------------------------------------
// Voice pipeline — Gemini 3.1 Flash Live (audio-to-audio, single WebSocket)
// ---------------------------------------------------------------------------

import { startGeminiLive, type GeminiLiveHandle } from "./gemini-live";
import type { VoiceSessionState } from "@/shared/voice";

export type VoicePipelineEvent =
  | { type: "state_changed"; state: VoiceSessionState; error?: string }
  | { type: "transcript_partial"; text: string }
  | { type: "transcript_final"; text: string }
  | { type: "assistant_transcript"; text: string };

export type VoicePipelineListener = (event: VoicePipelineEvent) => void;

export type VoicePipelineConfig = {
  googleApiKey: string;
  geminiVoice?: string;
};

export class VoicePipeline {
  private live: GeminiLiveHandle | null = null;
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
      this.live = await startGeminiLive(
        this.config.googleApiKey,
        this.config.geminiVoice,
        {
          onUserTranscript: (text, isFinal) => {
            if (isFinal) {
              this.emit({ type: "transcript_partial", text: "" });
              if (text.trim()) {
                this.emit({ type: "transcript_final", text: text.trim() });
              }
            } else if (text.trim()) {
              this.emit({ type: "transcript_partial", text });
            }
          },
          onAssistantTranscript: (text, isFinal) => {
            if (isFinal && text.trim()) {
              this.emit({ type: "assistant_transcript", text: text.trim() });
            }
          },
          onError: (error) => {
            console.error("[voice] Gemini Live error:", error);
            this.disconnect();
            this.setState("error", error);
          },
          onClose: (clean, reason) => {
            if (clean) {
              // Expected end-of-session (e.g. 15-min cap). Transition back
              // to inactive without surfacing an error banner.
              this.disconnect();
            } else {
              console.error("[voice] Gemini Live disconnected:", reason);
              this.disconnect();
              this.setState("error", `Gemini Live disconnected: ${reason}`);
            }
          },
        },
      );
      this.setState("connected");
    } catch (err) {
      this.disconnect();
      this.setState("error", err instanceof Error ? err.message : String(err));
    }
  }

  disconnect(): void {
    this.live?.stop();
    this.live = null;
    this.setState("inactive");
  }

  // Gemini Live generates and voices responses itself — there is no text-in
  // path mid-conversation, so these are no-ops. Retained because agent-store
  // fires them on every streaming delta from the pi-agent's (text-channel)
  // output, which should not be routed back into the voice session.
  speakText(_text: string): void {}

  flushSpeech(): void {}

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
