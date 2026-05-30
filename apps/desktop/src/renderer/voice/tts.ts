// ---------------------------------------------------------------------------
// ElevenLabs streaming TTS — lazy WebSocket, immediate playback
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
const MODEL_ID = "eleven_flash_v2_5";
const SAMPLE_RATE = 24000;

export type TTSHandle = {
  sendText: (text: string) => void;
  flush: () => void;
  interrupt: () => void;
  close: () => void;
};

export function createTTS(apiKey: string, voiceId: string = DEFAULT_VOICE_ID): TTSHandle {
  const baseUri =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
    `?model_id=${MODEL_ID}&output_format=pcm_${SAMPLE_RATE}`;

  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  let nextPlayTime = 0;
  let muted = false;
  const activeSources: Set<AudioBufferSourceNode> = new Set();

  let ws: WebSocket | null = null;
  let pendingText: string[] = [];

  function ensureConnection(): WebSocket {
    if (ws && ws.readyState <= WebSocket.OPEN) return ws;

    const socket = new WebSocket(baseUri);
    ws = socket;

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          xi_api_key: apiKey,
        }),
      );
      // Send any text that arrived while connecting
      for (const text of pendingText) {
        socket.send(JSON.stringify({ text, try_trigger_generation: true }));
      }
      pendingText = [];
    });

    socket.addEventListener("message", (event) => {
      if (muted) return;
      try {
        const data = JSON.parse(String(event.data)) as { audio?: string };
        if (data.audio) {
          const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
          playChunk(bytes.buffer);
        }
      } catch {
        // ignore
      }
    });

    socket.addEventListener("error", () => {
      ws = null;
    });

    socket.addEventListener("close", () => {
      ws = null;
    });

    return socket;
  }

  function playChunk(pcm: ArrayBuffer): void {
    const int16 = new Int16Array(pcm);
    if (int16.length === 0) return;

    if (audioCtx.state === "suspended") void audioCtx.resume();

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = (int16[i] ?? 0) / 32768;
    }

    const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.addEventListener("ended", () => activeSources.delete(source), { once: true });
    activeSources.add(source);

    const now = audioCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function stopAllSources(): void {
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    activeSources.clear();
    nextPlayTime = 0;
  }

  return {
    sendText: (text: string) => {
      // New text from agent always unmutes — the agent is responding fresh
      muted = false;
      const socket = ensureConnection();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ text, try_trigger_generation: true }));
      } else {
        pendingText.push(text);
      }
    },
    flush: () => {
      // Close the current connection so it doesn't timeout idle.
      // Next sendText will open a fresh one.
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" }));
      }
      ws = null;
      muted = false;
    },
    interrupt: () => {
      muted = true;
      pendingText = [];
      stopAllSources();
      // Kill the connection — remaining server-side audio is discarded
      if (ws) {
        ws.close();
        ws = null;
      }
    },
    close: () => {
      stopAllSources();
      void audioCtx.close();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
