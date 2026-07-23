// ---------------------------------------------------------------------------
// Main-process proxy for ElevenLabs streaming TTS. The renderer used to hold
// the API key + open a direct WS to api.elevenlabs.io — both moved here so
// the key never sits in renderer memory and the renderer surfaces only
// "play this PCM chunk" / "stop". One singleton WS per session is reused
// across sendText calls.
//
// Key resolution: the injected `getApiKey` source (the voice handler wires
// voice-secret.ts's SecretStore read — ui-state is never involved) wins; the
// ELEVENLABS_API_KEY env var is a dev-only fallback (packaged builds
// launched from Finder/Dock inherit no shell env). Resolved lazily on every
// connection/availability check so a key saved mid-session takes effect
// without a restart.
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
const MODEL_ID = "eleven_flash_v2_5";
const SAMPLE_RATE = 24000;

let ws: WebSocket | null = null;
let pendingText: string[] = [];

function isAudioPayload(value: unknown): value is { audio: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return "audio" in value && typeof value.audio === "string";
}

function endpoint(voiceId: string): string {
  return (
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
    `?model_id=${MODEL_ID}&output_format=pcm_${SAMPLE_RATE}`
  );
}

/** Host seams injected at register time (the voice handler) — one object,
 * mirroring model-download.ts's `configureVoiceModelHost` shape. */
export type TtsHost = {
  /** Where the stored key comes from (the voice handler passes
   * voice-secret.ts's SecretStore read — ui-state is never involved).
   * Defaults to "no stored key" so the proxy stays constructible without the
   * host composition (tests, harness); the env fallback below still applies
   * then. */
  getApiKey: () => string | null;
  /** Where decoded PCM chunks go (the voice handler passes an onTtsAudio
   * event-bus emit — voice/ never imports the event bus). Defaults to a
   * drop, exactly like an event-bus emission with no transport subscribed,
   * so the proxy stays constructible without the host composition (tests,
   * harness). */
  emitAudio: (audio: ArrayBuffer) => void;
};

let getApiKey: TtsHost["getApiKey"] = () => null;
let emitAudio: TtsHost["emitAudio"] = () => {};

/** Install the host seams once at register time. */
export function configureTts(host: TtsHost): void {
  getApiKey = host.getApiKey;
  emitAudio = host.emitAudio;
}

function resolveApiKey(): string | null {
  const stored = getApiKey();
  if (stored && stored.trim().length > 0) return stored.trim();
  const env = process.env["ELEVENLABS_API_KEY"];
  return env && env.trim().length > 0 ? env.trim() : null;
}

function ensureConnection(): WebSocket | null {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws;
  const apiKey = resolveApiKey();
  if (!apiKey) return null;
  // Blank-safe: a `.env` line of `ELEVENLABS_VOICE_ID=` loads as "" (a value,
  // not "unset"), which `??` would happily pass through into the endpoint URL.
  const voiceOverride = process.env["ELEVENLABS_VOICE_ID"]?.trim();
  const voiceId = voiceOverride ? voiceOverride : DEFAULT_VOICE_ID;
  const socket = new WebSocket(endpoint(voiceId));
  ws = socket;

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        text: " ",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        xi_api_key: apiKey,
      }),
    );
    for (const text of pendingText) {
      socket.send(JSON.stringify({ text, try_trigger_generation: true }));
    }
    pendingText = [];
  });

  socket.addEventListener("message", (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(String(event.data));
      if (isAudioPayload(data)) {
        // Base64-decoded PCM 24kHz int16 chunk — emit raw bytes to renderer.
        const buffer = Buffer.from(data.audio, "base64").buffer.slice(0);
        emitAudio(buffer);
      }
    } catch {
      // ignore malformed frames
    }
  });

  socket.addEventListener("close", () => {
    ws = null;
  });
  socket.addEventListener("error", () => {
    ws = null;
  });

  return socket;
}

export function ttsSend(text: string): void {
  const socket = ensureConnection();
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ text, try_trigger_generation: true }));
  } else {
    pendingText.push(text);
  }
}

/** Signal end-of-stream so ElevenLabs flushes the final chunks, then drop the
 * connection so it doesn't time out idle. The next ttsSend opens a fresh WS. */
export function ttsFlush(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ text: "" }));
  }
  ws = null;
}

/** Drop pending text + kill the socket so server-side audio is discarded. The
 * renderer's AudioContext side stops via its own ttsInterrupt path. */
export function ttsInterrupt(): void {
  pendingText = [];
  if (ws) {
    ws.close();
    ws = null;
  }
}

/** Whether ElevenLabs credentials are configured (settings store or env). */
export function ttsAvailable(): boolean {
  return resolveApiKey() !== null;
}
