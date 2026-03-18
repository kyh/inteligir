// ---------------------------------------------------------------------------
// ElevenLabs streaming TTS via native WebSocket (input-streaming protocol)
// ---------------------------------------------------------------------------

const TTS_MODEL = "eleven_flash_v2_5";

export class ElevenLabsTTS {
  private ws: WebSocket | null = null;
  private onAudioChunk: ((base64: string) => void) | null = null;
  private onDone: (() => void) | null = null;
  private onError: ((error: string) => void) | null = null;

  constructor(
    private apiKey: string,
    private voiceId: string,
  ) {}

  speak(
    text: string,
    opts: {
      onAudioChunk: (base64: string) => void;
      onDone: () => void;
      onError: (error: string) => void;
    },
  ): void {
    this.onAudioChunk = opts.onAudioChunk;
    this.onDone = opts.onDone;
    this.onError = opts.onError;

    const params = new URLSearchParams({
      model_id: TTS_MODEL,
      output_format: "mp3_44100_128",
    });
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?${params.toString()}`;

    // Node.js WebSocket (via ws) supports a headers option not in the browser spec.
    // This cast is intentional — this class only runs in the Electron main process.
    const ws = new WebSocket(url, {
      headers: { "xi-api-key": this.apiKey },
    } as unknown as string[]);

    ws.addEventListener("open", () => {
      // BOS — beginning of stream with voice settings
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            style: 0.2,
          },
        }),
      );

      // Send the actual text
      ws.send(JSON.stringify({ text, try_trigger_generation: true }));

      // EOS — empty string signals end of input
      ws.send(JSON.stringify({ text: "" }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.audio) {
          this.onAudioChunk?.(data.audio);
        }
        if (data.isFinal) {
          this.onDone?.();
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      this.ws = null;
      this.onError?.("TTS WebSocket error");
      this.onError = null;
      this.onDone = null;
      this.onAudioChunk = null;
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.onDone?.();
      this.onDone = null;
    });

    this.ws = ws;
  }

  interrupt(): void {
    this.onDone = null; // Prevent done callback on close
    this.onAudioChunk = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
