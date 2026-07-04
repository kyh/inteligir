// ---------------------------------------------------------------------------
// Renderer-side TTS client. The WebSocket + API key live in main (see
// main/voice/tts-proxy.ts); the renderer's job is just to push outgoing text
// through the bridge and play the PCM chunks main streams back.
// ---------------------------------------------------------------------------

import { getBridge } from "@renderer/lib/bridge";

const SAMPLE_RATE = 24000;

export type TTSHandle = {
  sendText: (text: string) => void;
  flush: () => void;
  interrupt: () => void;
  close: () => void;
};

export function createTTS(): TTSHandle {
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  let nextPlayTime = 0;
  let muted = false;
  const activeSources: Set<AudioBufferSourceNode> = new Set();

  function playChunk(pcm: ArrayBuffer): void {
    if (muted) return;
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

  const bridge = getBridge();
  const unsubscribe = bridge?.onTtsAudio((event) => {
    playChunk(event.audio);
  });

  return {
    sendText: (text: string) => {
      muted = false;
      bridge?.ttsSend({ text });
    },
    flush: () => {
      bridge?.ttsFlush(undefined);
      muted = false;
    },
    interrupt: () => {
      muted = true;
      stopAllSources();
      bridge?.ttsInterrupt(undefined);
    },
    close: () => {
      unsubscribe?.();
      stopAllSources();
      void audioCtx.close();
      bridge?.ttsInterrupt(undefined);
    },
  };
}
