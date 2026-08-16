// ---------------------------------------------------------------------------
// Voice pipeline — pure I/O wrapper over the host's STT and TTS, both reached
// over the Bridge. Holds no internal state;
// the caller (voice-store + VoiceMachine) owns the lifecycle and reacts to
// callbacks.
// ---------------------------------------------------------------------------

import { startSTT, type STTHandle } from "./stt";
import { createTTS, type TTSHandle } from "./tts";

export type VoicePipelineConfig = {
  onTranscriptPartial: (text: string) => void;
  onTranscriptFinal: (text: string) => void;
  onError: (message: string) => void;
};

export class VoicePipeline {
  private stt: STTHandle | null = null;
  private tts: TTSHandle | null = null;

  constructor(private readonly config: VoicePipelineConfig) {}

  /**
   * Acquire mic + start the recognizer. Resolves when ready to receive audio;
   * rejects on mic-denial or a host-side start failure (no state side effect,
   * the caller decides what to do).
   */
  async connect(): Promise<void> {
    this.tts = createTTS();

    try {
      this.stt = await startSTT(
        (text, isFinal) => {
          if (isFinal) {
            this.config.onTranscriptPartial("");
            const trimmed = text.trim();
            if (trimmed) this.config.onTranscriptFinal(trimmed);
          } else if (text.trim()) {
            // Interrupt TTS the moment the user starts speaking.
            this.tts?.interrupt();
            this.config.onTranscriptPartial(text);
          }
        },
        (error) => {
          void this.disconnect();
          this.config.onError(error);
        },
      );
    } catch (err) {
      this.tts?.close();
      this.tts = null;
      throw err;
    }
  }

  disconnect(): Promise<void> {
    const pendingStop = this.stt?.stop() ?? Promise.resolve();
    this.stt = null;
    this.tts?.close();
    this.tts = null;
    return pendingStop;
  }

  speakText(text: string): void {
    this.tts?.sendText(text);
  }

  flushSpeech(): void {
    this.tts?.flush();
  }
}
