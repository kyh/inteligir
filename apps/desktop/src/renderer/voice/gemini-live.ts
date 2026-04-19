// ---------------------------------------------------------------------------
// Gemini Live audio-to-audio provider (3.1 Flash Live Preview)
// ---------------------------------------------------------------------------
// Replaces the Deepgram-STT → pi-agent → ElevenLabs-TTS chain with a single
// bidirectional WebSocket. Gemini Live handles ASR + generation + TTS in one
// session — so when this provider is active, text turns DO NOT route through
// the pi-coding-agent. That's a product decision, not a plumbing one.
//
// Audio format: 16 kHz PCM in, 24 kHz PCM out (same rates the existing stack
// already uses, so the Web Audio glue below mirrors stt.ts/tts.ts).
//
// Session cap: 15 min audio-only on the Live API. For longer sessions add
// session resumption (config.sessionResumption) + context compression.

import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

// Swap to "gemini-live-2.5-flash-native-audio" for GA. 3.1 is preview as of
// 2026-04 — breaking-change risk, tighter quotas.
const MODEL_ID = "gemini-3.1-flash-live-preview";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Prebuilt Gemini voices: Zephyr, Puck, Charon, Kore, Fenrir, Aoede, ...
const DEFAULT_VOICE = "Aoede";

export type GeminiLiveCallbacks = {
  // Fires incrementally with accumulated user speech; `isFinal` true once
  // Gemini signals the user's turn ended (first output-transcription arrives).
  onUserTranscript: (text: string, isFinal: boolean) => void;
  // Fires incrementally with accumulated assistant speech; `isFinal` true on
  // `turnComplete`.
  onAssistantTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
};

export type GeminiLiveHandle = {
  interrupt: () => void;
  stop: () => void;
};

export async function startGeminiLive(
  apiKey: string,
  voice: string = DEFAULT_VOICE,
  callbacks: GeminiLiveCallbacks,
): Promise<GeminiLiveHandle> {
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });

  // --- Mic capture (16 kHz PCM) ---------------------------------------------
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
  const sourceNode = inputCtx.createMediaStreamSource(stream);
  const processorNode = inputCtx.createScriptProcessor(4096, 1, 1);
  const silentOutput = inputCtx.createGain();
  silentOutput.gain.value = 0;

  // --- Playback (24 kHz PCM) ------------------------------------------------
  const outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  let nextPlayTime = 0;
  const activeSources = new Set<AudioBufferSourceNode>();
  let stopped = false;

  // Per-turn transcript accumulators. Gemini streams both input (user) and
  // output (assistant) transcription as incremental fragments; we only emit
  // `isFinal=true` at meaningful boundaries:
  //   - user final: first output fragment of a turn (= Gemini decided user
  //     stopped speaking and began generating)
  //   - assistant final: `turnComplete` signal
  let userBuffer = "";
  let assistantBuffer = "";
  let userFinalized = false;
  // Flips false once the server-side session is no longer usable so
  // onaudioprocess stops pushing audio into a dead socket.
  let sessionAlive = false;

  function playChunk(pcm: ArrayBuffer): void {
    const int16 = new Int16Array(pcm);
    if (int16.length === 0) return;
    if (outputCtx.state === "suspended") void outputCtx.resume();

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = (int16[i] ?? 0) / 32768;
    }
    const buffer = outputCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const src = outputCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outputCtx.destination);
    src.onended = () => activeSources.delete(src);
    activeSources.add(src);

    const now = outputCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function stopPlayback(): void {
    for (const src of activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    activeSources.clear();
    nextPlayTime = 0;
  }

  // --- Live session ---------------------------------------------------------
  let session: Session | null = null;

  try {
    session = await ai.live.connect({
      model: MODEL_ID,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
        // Surface transcripts for UI + chat-history logging
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          sessionAlive = true;
          processorNode.onaudioprocess = (event) => {
            if (stopped || !sessionAlive || !session) return;
            const float32 = event.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i] ?? 0));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const b64 = btoa(
              String.fromCharCode(...new Uint8Array(int16.buffer)),
            );
            session.sendRealtimeInput({
              audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
            });
          };
          sourceNode.connect(processorNode);
          processorNode.connect(silentOutput);
          silentOutput.connect(inputCtx.destination);
        },

        onmessage: (msg: LiveServerMessage) => {
          if (stopped) return;

          // Server-initiated interrupt (user spoke over model)
          if (msg.serverContent?.interrupted) {
            stopPlayback();
            // Reset all per-turn state — the interrupting utterance starts a
            // fresh turn, so any partial user/assistant accumulation from the
            // interrupted turn must not leak into the next one.
            userBuffer = "";
            assistantBuffer = "";
            userFinalized = false;
            return;
          }

          // Streamed audio chunk — inlineData is base64 PCM 24 kHz mono
          const parts = msg.serverContent?.modelTurn?.parts ?? [];
          for (const part of parts) {
            const data = part.inlineData?.data;
            if (data) {
              const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
              playChunk(bytes.buffer);
            }
          }

          const userFragment = msg.serverContent?.inputTranscription?.text;
          if (userFragment) {
            userBuffer += userFragment;
            callbacks.onUserTranscript(userBuffer, false);
          }

          const assistantFragment = msg.serverContent?.outputTranscription?.text;
          if (assistantFragment) {
            // First assistant fragment of this turn → user turn is done.
            if (!userFinalized && userBuffer) {
              callbacks.onUserTranscript(userBuffer, true);
              userFinalized = true;
            }
            assistantBuffer += assistantFragment;
            callbacks.onAssistantTranscript(assistantBuffer, false);
          }

          // `turnComplete` = model finished its reply; reset per-turn state.
          if (msg.serverContent?.turnComplete) {
            if (!userFinalized && userBuffer) {
              callbacks.onUserTranscript(userBuffer, true);
            }
            if (assistantBuffer) {
              callbacks.onAssistantTranscript(assistantBuffer, true);
            }
            userBuffer = "";
            assistantBuffer = "";
            userFinalized = false;
          }
        },

        onerror: (e: ErrorEvent) => {
          callbacks.onError(`Gemini Live error: ${e.message}`);
        },

        onclose: (e: CloseEvent) => {
          // Mark the session dead first so onaudioprocess stops pumping audio
          // into it, regardless of close code.
          sessionAlive = false;
          if (stopped) return;
          // Any server-initiated close (even a clean 1000 from session-cap
          // timeout) must surface so the pipeline transitions out of
          // "connected" — otherwise the mic keeps capturing into the void.
          callbacks.onError(
            e.code === 1000
              ? "Gemini Live session ended"
              : `Gemini Live disconnected: ${e.reason || `code ${String(e.code)}`}`,
          );
        },
      },
    });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void inputCtx.close();
    void outputCtx.close();
    throw err;
  }

  return {
    interrupt: () => {
      stopPlayback();
      // No explicit cancel frame in the Live API — stopping playback and
      // letting the next user utterance trigger server-side interruption is
      // sufficient.
    },
    stop: () => {
      stopped = true;
      processorNode.disconnect();
      sourceNode.disconnect();
      void inputCtx.close();
      stopPlayback();
      void outputCtx.close();
      stream.getTracks().forEach((t) => t.stop());
      session?.close();
      session = null;
    },
  };
}
