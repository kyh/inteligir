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
  private onConnected: (() => void) | null = null;
  private retryCount = 0;
  private closed = false;
  private sendCount = 0;

  constructor(private apiKey: string) {}

  connect(opts: {
    onTranscript: VoiceTranscriptCallback;
    onError: (error: string) => void;
    onConnected: () => void;
  }): void {
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;
    this.onConnected = opts.onConnected;
    this.closed = false;
    this.retryCount = 0;
    this.openConnection();
  }

  sendAudio(base64Chunk: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.sendCount === 0) console.warn("[stt] ws not open, dropping audio");
      return;
    }
    this.sendCount++;
    if (this.sendCount <= 3 || this.sendCount % 200 === 0) {
      console.log(`[stt] sending chunk #${this.sendCount}`);
    }
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: base64Chunk,
        commit: false,
        sample_rate: 16000,
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
      language_code: "en",
      encoding: "pcm_s16le",
      sample_rate: "16000",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "1.5",
      vad_threshold: "0.4",
    });
    const url = `${STT_WS_URL}?${params.toString()}`;

    // Node.js WebSocket (via ws) supports a headers option not in the browser spec.
    // This cast is intentional — this class only runs in the Electron main process.
    const ws = new WebSocket(url, {
      headers: { "xi-api-key": this.apiKey },
    } as unknown as string[]);

    ws.addEventListener("open", () => {
      // Reset retry count on successful connect so future disconnects get fresh retries
      this.retryCount = 0;
      this.sendCount = 0;
      this.onConnected?.();
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const msgType = (data.message_type ?? data.event) as string;
        console.log("[stt] received:", msgType, JSON.stringify(data).slice(0, 200));

        switch (msgType) {
          case "partial_transcript":
            this.onTranscript?.({
              text: data.text ?? data.transcript ?? "",
              isFinal: false,
            });
            break;
          case "committed_transcript":
            this.onTranscript?.({
              text: data.text ?? data.transcript ?? "",
              isFinal: true,
            });
            break;
          case "session_started":
            console.log("[stt] session started:", data.session_id);
            break;
          case "input_error":
            console.error("[stt] input error:", data.error ?? data.message);
            break;
        }
      } catch (err) {
        console.error("[stt] failed to parse message:", err);
      }
    });

    ws.addEventListener("error", (err) => {
      console.error("[stt] ws error:", err);
    });

    ws.addEventListener("close", (ev) => {
      console.log("[stt] ws closed, code:", ev.code, "reason:", ev.reason);
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
