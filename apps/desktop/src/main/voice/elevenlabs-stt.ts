// ---------------------------------------------------------------------------
// ElevenLabs Scribe v2 Realtime — streaming STT via native WebSocket
// ---------------------------------------------------------------------------

import type { VoiceTranscriptCallback } from "./voice-service";

const STT_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export type SttTranscript = {
  text: string;
  isFinal: boolean;
};

export class ElevenLabsSTT {
  private ws: WebSocket | null = null;
  private onTranscript: VoiceTranscriptCallback | null = null;
  private onError: ((error: string) => void) | null = null;
  private retryCount = 0;
  private closed = false;

  constructor(private apiKey: string) {}

  connect(opts: {
    onTranscript: VoiceTranscriptCallback;
    onError: (error: string) => void;
  }): void {
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;
    this.closed = false;
    this.retryCount = 0;
    this.openConnection();
  }

  sendAudio(base64Chunk: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "input_audio_chunk",
        audio_base_64: base64Chunk,
      }),
    );
  }

  close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private openConnection(): void {
    if (this.closed) return;

    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      sample_rate: "16000",
      encoding: "pcm_s16le",
      language_code: "en",
    });
    const url = `${STT_WS_URL}?${params.toString()}`;

    const ws = new WebSocket(url, {
      headers: { "xi-api-key": this.apiKey },
    } as unknown as string[]);

    ws.addEventListener("open", () => {
      this.retryCount = 0;
      ws.send(
        JSON.stringify({
          type: "configure",
          transcription_config: {
            commit_strategy: "vad",
          },
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "transcript" && data.transcript) {
          this.onTranscript?.({
            text: data.transcript.text ?? "",
            isFinal: false,
          });
        } else if (data.type === "committed_transcript" && data.transcript) {
          this.onTranscript?.({
            text: data.transcript.text ?? "",
            isFinal: true,
          });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      // Error will be followed by close event
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.closed && this.retryCount < MAX_RETRIES) {
        this.retryCount++;
        const delay = RETRY_BASE_MS * Math.pow(2, this.retryCount - 1);
        setTimeout(() => this.openConnection(), delay);
      } else if (!this.closed) {
        this.onError?.("STT connection lost after retries");
      }
    });

    this.ws = ws;
  }
}
