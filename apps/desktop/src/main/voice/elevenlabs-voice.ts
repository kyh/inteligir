// ---------------------------------------------------------------------------
// ElevenLabs voice — unified STT (Scribe v2) + TTS WebSocket client
// ---------------------------------------------------------------------------

import type { SttConfig } from "@/shared/voice";

const STT_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const TTS_MODEL = "eleven_flash_v2_5";
const MAX_STT_RETRIES = 3;
const STT_RETRY_BASE_MS = 1000;

type TranscriptCallback = (t: { text: string; isFinal: boolean }) => void;

export class ElevenLabsVoice {
  // STT state
  private sttWs: WebSocket | null = null;
  private sttRetryCount = 0;
  private sttClosed = false;
  private onTranscript: TranscriptCallback | null = null;
  private onSttError: ((error: string) => void) | null = null;
  private onSttConnected: (() => void) | null = null;

  // TTS state
  private ttsWs: WebSocket | null = null;
  private onAudioChunk: ((base64: string) => void) | null = null;
  private onTtsDone: (() => void) | null = null;
  private onTtsError: ((error: string) => void) | null = null;

  constructor(private apiKey: string) {}

  // -- STT -----------------------------------------------------------------

  connectStt(
    config: SttConfig,
    opts: {
      onTranscript: TranscriptCallback;
      onError: (error: string) => void;
      onConnected: () => void;
    },
  ): void {
    this.onTranscript = opts.onTranscript;
    this.onSttError = opts.onError;
    this.onSttConnected = opts.onConnected;
    this.sttClosed = false;
    this.sttRetryCount = 0;
    this.openSttConnection(config);
  }

  sendAudio(base64Chunk: string, sampleRate: number): void {
    if (!this.sttWs || this.sttWs.readyState !== WebSocket.OPEN) return;
    this.sttWs.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: base64Chunk,
        commit: false,
        sample_rate: sampleRate,
      }),
    );
  }

  closeStt(): void {
    this.sttClosed = true;
    if (this.sttWs) {
      this.sttWs.close();
      this.sttWs = null;
    }
  }

  // -- TTS -----------------------------------------------------------------

  speak(
    voiceId: string,
    text: string,
    opts: {
      onAudioChunk: (base64: string) => void;
      onDone: () => void;
      onError: (error: string) => void;
    },
  ): void {
    this.onAudioChunk = opts.onAudioChunk;
    this.onTtsDone = opts.onDone;
    this.onTtsError = opts.onError;

    const params = new URLSearchParams({
      model_id: TTS_MODEL,
      output_format: "mp3_44100_128",
    });
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?${params.toString()}`;
    const ws = this.createWebSocket(url);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2 },
        }),
      );
      ws.send(JSON.stringify({ text, try_trigger_generation: true }));
      ws.send(JSON.stringify({ text: "" }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.audio) this.onAudioChunk?.(data.audio);
        if (data.isFinal) {
          this.onTtsDone?.();
          this.onTtsDone = null;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      this.ttsWs = null;
      this.onTtsError?.("TTS WebSocket error");
      this.onTtsError = null;
      this.onTtsDone = null;
      this.onAudioChunk = null;
    });

    ws.addEventListener("close", () => {
      this.ttsWs = null;
      this.onTtsDone?.();
      this.onTtsDone = null;
    });

    this.ttsWs = ws;
  }

  interruptTts(): void {
    this.onTtsDone = null;
    this.onAudioChunk = null;
    if (this.ttsWs) {
      this.ttsWs.close();
      this.ttsWs = null;
    }
  }

  // -- Lifecycle -----------------------------------------------------------

  dispose(): void {
    this.closeStt();
    this.interruptTts();
  }

  // -- Private -------------------------------------------------------------

  private openSttConnection(config: SttConfig): void {
    if (this.sttClosed) return;

    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      language_code: config.languageCode,
      encoding: "pcm_s16le",
      sample_rate: String(config.sampleRate),
      commit_strategy: "vad",
      vad_silence_threshold_secs: String(config.vadSilenceThresholdSecs),
      vad_threshold: String(config.vadThreshold),
    });
    const url = `${STT_WS_URL}?${params.toString()}`;
    const ws = this.createWebSocket(url);

    ws.addEventListener("open", () => {
      this.sttRetryCount = 0;
      this.onSttConnected?.();
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const msgType = (data.message_type ?? data.event) as string;

        switch (msgType) {
          case "partial_transcript":
            this.onTranscript?.({ text: data.text ?? data.transcript ?? "", isFinal: false });
            break;
          case "committed_transcript":
            this.onTranscript?.({ text: data.text ?? data.transcript ?? "", isFinal: true });
            break;
          case "session_started":
            // Log session ID for post-hoc debugging
            console.log("[stt] session:", data.session_id);
            break;
          case "input_error":
            console.error("[stt] input error:", data.error ?? data.message);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      // Error will be followed by close event
    });

    ws.addEventListener("close", () => {
      this.sttWs = null;
      if (!this.sttClosed && this.sttRetryCount < MAX_STT_RETRIES) {
        this.sttRetryCount++;
        const delay = STT_RETRY_BASE_MS * Math.pow(2, this.sttRetryCount - 1);
        setTimeout(() => this.openSttConnection(config), delay);
      } else if (!this.sttClosed) {
        this.onSttError?.("STT connection lost after retries");
      }
    });

    this.sttWs = ws;
  }

  /** Shared WebSocket factory — centralizes the Node.js headers cast.
   *  Electron main uses Node's built-in WebSocket which accepts { headers }
   *  at runtime, but the DOM WebSocket type doesn't declare it. The double
   *  cast is unavoidable without a separate ws dependency. */
  private createWebSocket(url: string): WebSocket {
    return new WebSocket(url, {
      headers: { "xi-api-key": this.apiKey },
    } as unknown as string[]);
  }
}
