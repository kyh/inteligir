import { emitEvent } from "../events";
import { getPlatform } from "../platform-instance";
import { getUiState } from "../ui-state";
import type { HandlerRegistrar } from "./handler-registry";
import {
  configureVoiceModelHost,
  downloadModel,
  isModelInstalled,
} from "@repo/voice/model-download";
import { initParakeet, pushAudio, startSession, stopSession } from "@repo/voice/parakeet";
import {
  configureTtsApiKey,
  configureTtsAudioSink,
  ttsAvailable,
  ttsFlush,
  ttsInterrupt,
  ttsSend,
} from "@repo/voice/tts-proxy";
import { getVoiceApiKey, setVoiceApiKey } from "@repo/voice/voice-secret";

export function registerVoiceHandlers(handle: HandlerRegistrar): void {
  // Voice owns its secret: the proxy reads the stored key through this
  // injected source (voice-secret → SecretStore), never through ui-state.
  configureTtsApiKey(() => getVoiceApiKey());
  // Host seams for the extracted voice package (it sits below the server, so
  // the event bus + platform capabilities are injected here, at register time
  // — before any transport can deliver a voice call).
  configureTtsAudioSink((audio) => emitEvent("onTtsAudio", { audio }));
  configureVoiceModelHost({
    userDataDir: () => getPlatform().userDataDir,
    emitState: (event) => emitEvent("onVoiceModelState", event),
  });

  handle("isTtsAvailable", () => ttsAvailable());
  handle("setVoiceApiKey", ({ value }) => {
    // ui-state (the presence marker) is a server store — bound here.
    setVoiceApiKey(value, getUiState());
  });
  handle("ttsSend", ({ text }) => ttsSend(text));
  handle("ttsFlush", () => ttsFlush());
  handle("ttsInterrupt", () => ttsInterrupt());

  handle("startStt", async () => {
    const result = await initParakeet();
    if (!result.ok) return { ok: false, error: result.reason };
    startSession();
    return { ok: true };
  });

  handle("sendSttAudio", (payload) => {
    // Fire-and-forget hot path — uncaught throws on the event loop would crash
    // the host, so swallow + log and keep the session alive.
    try {
      // Honor byteOffset/byteLength: a Buffer view may sit inside a larger
      // pooled ArrayBuffer.
      const samples =
        payload instanceof ArrayBuffer
          ? new Float32Array(payload)
          : new Float32Array(
              payload.buffer,
              payload.byteOffset,
              payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
            );
      const events = pushAudio(samples);
      for (const ev of events) {
        emitEvent("onSttTranscript", ev);
      }
    } catch (err) {
      console.error("[voice] audio chunk handler failed:", err);
    }
  });

  handle("stopStt", () => stopSession());
  handle("getVoiceModelStatus", () => (isModelInstalled() ? "ready" : "missing"));
  handle("downloadVoiceModel", () => downloadModel());
}
