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

import { emitEvent } from "../events";

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

// Injected stored-key source (configureTtsApiKey). Defaults to "no stored
// key" so the proxy stays constructible without the host composition (tests,
// harness); the env fallback below still applies then.
let getApiKey: () => string | null = () => null;

/** Inject where the stored key comes from (the voice handler passes
 * voice-secret.ts's SecretStore read at register time). */
export function configureTtsApiKey(source: () => string | null): void {
  getApiKey = source;
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
  const voiceId = process.env["ELEVENLABS_VOICE_ID"] ?? DEFAULT_VOICE_ID;
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
        emitEvent("onTtsAudio", { audio: buffer });
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
