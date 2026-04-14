// ---------------------------------------------------------------------------
// ElevenLabs streaming TTS — text chunks → gapless audio playback
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";
const MODEL_ID = "eleven_flash_v2_5";
const SAMPLE_RATE = 24000;

// Buffer audio for this many ms before starting playback to absorb jitter
const PRE_BUFFER_MS = 150;

export type TTSHandle = {
  sendText: (text: string) => void;
  flush: () => void;
  interrupt: () => void;
  close: () => void;
};

export function createTTS(
  apiKey: string,
  voiceId: string = DEFAULT_VOICE_ID,
): TTSHandle {
  const uri =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
    `?model_id=${MODEL_ID}&output_format=pcm_${SAMPLE_RATE}`;

  const ws = new WebSocket(uri);
  let audioCtx: AudioContext | null = null;
  let nextPlayTime = 0;
  let interrupted = false;

  // Pre-buffer: accumulate PCM samples before first playback
  let preBuffer: Int16Array[] = [];
  let preBufferSamples = 0;
  let playbackStarted = false;
  const preBufferThreshold = Math.floor((SAMPLE_RATE * PRE_BUFFER_MS) / 1000);

  function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      nextPlayTime = 0;
    }
    return audioCtx;
  }

  function scheduleBuffer(int16: Int16Array): void {
    if (interrupted || int16.length === 0) return;
    const ctx = getAudioContext();

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = (int16[i] ?? 0) / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function drainPreBuffer(): void {
    if (preBuffer.length === 0) return;
    // Concatenate all buffered chunks into one
    const total = preBuffer.reduce((sum, b) => sum + b.length, 0);
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of preBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    preBuffer = [];
    preBufferSamples = 0;
    scheduleBuffer(merged);
  }

  function onPCMChunk(pcmBuffer: ArrayBuffer): void {
    if (interrupted) return;
    const int16 = new Int16Array(pcmBuffer);

    if (!playbackStarted) {
      // Accumulate until we have enough for smooth start
      preBuffer.push(int16);
      preBufferSamples += int16.length;
      if (preBufferSamples >= preBufferThreshold) {
        playbackStarted = true;
        drainPreBuffer();
      }
      return;
    }

    scheduleBuffer(int16);
  }

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        text: " ",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        xi_api_key: apiKey,
      }),
    );
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { audio?: string; isFinal?: boolean };
      if (data.audio) {
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        onPCMChunk(bytes.buffer);
      }
      // If this is the final chunk, drain any remaining pre-buffer
      if (data.isFinal && !playbackStarted) {
        playbackStarted = true;
        drainPreBuffer();
      }
    } catch {
      // Non-JSON or parse error
    }
  };

  ws.onerror = (err) => {
    console.error("[tts] WebSocket error:", err);
  };

  function resetPlayback(): void {
    preBuffer = [];
    preBufferSamples = 0;
    playbackStarted = false;
    nextPlayTime = 0;
  }

  return {
    sendText: (text: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (interrupted) {
          interrupted = false;
          audioCtx = null; // force new context
          resetPlayback();
        }
        ws.send(JSON.stringify({ text }));
      }
    },
    flush: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" }));
      }
      // Drain anything left in pre-buffer
      if (!playbackStarted) {
        playbackStarted = true;
        drainPreBuffer();
      }
    },
    interrupt: () => {
      interrupted = true;
      resetPlayback();
      if (audioCtx) {
        void audioCtx.close();
        audioCtx = null;
      }
    },
    close: () => {
      interrupted = true;
      if (audioCtx) {
        void audioCtx.close();
        audioCtx = null;
      }
      ws.close();
    },
  };
}
