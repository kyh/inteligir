import { emitEvent } from "../events";
import type { HandlerRegistrar } from "./handler-registry";
import { downloadModel, isModelInstalled } from "@repo/voice/model-download";
import { initParakeet, pushAudio, startSession, stopSession } from "@repo/voice/parakeet";

// The voice package's MODEL host seam is installed at composition time
// (create-host.ts), not here, so a boot-time "is voice available" probe
// resolves before handler registration (#465.3).
export function registerVoiceHandlers(handle: HandlerRegistrar): void {
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
