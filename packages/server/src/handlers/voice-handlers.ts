import { emitEvent } from "../events";
import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";
import { initParakeet, pushAudio, startSession, stopSession } from "@repo/voice/parakeet";
import { configureTts, ttsAvailable, ttsFlush, ttsInterrupt, ttsSend } from "@repo/voice/tts-proxy";
import { getVoiceApiKey, setVoiceApiKey } from "@repo/voice/voice-secret";

/**
 * Narrow a sendSttAudio payload to Float32 PCM samples, or null when it is
 * neither an ArrayBuffer nor a view over one.
 *
 * The registry types this channel `unknown` on purpose — TypeBox has no
 * ArrayBuffer/ArrayBufferView primitive, so `BinaryAudioSchema` admits
 * anything and proving the shape is the handler's job. That matters here:
 * the binary transport hands us a standalone ArrayBuffer
 * (ws-protocol's decodeBinaryFrame), but the SAME registry entry is reachable
 * over a plain JSON `send` frame, where the payload is whatever the peer
 * encoded. So this refuses rather than reaching for `.buffer`/`.byteOffset`
 * off an object that may have neither.
 */
function toFloat32Samples(payload: unknown): Float32Array | null {
  if (payload instanceof ArrayBuffer) return new Float32Array(payload);
  // Honor byteOffset/byteLength: a Buffer view may sit inside a larger pooled
  // ArrayBuffer.
  if (ArrayBuffer.isView(payload)) {
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  return null;
}

export function registerVoiceHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "uiState" | "secrets">,
): void {
  // Host seams for the voice package (it sits below the server, so the event
  // bus + platform capabilities are injected — before any transport can
  // deliver a voice call). The MODEL host seam is installed earlier, at
  // composition time (create-host.ts), so a boot-time "is voice available"
  // probe resolves before handler registration.
  configureTts({
    // Voice owns its secret: the proxy reads the stored key through this
    // injected source (voice-secret → SecretStore), never through ui-state.
    getApiKey: () => getVoiceApiKey(services.secrets),
    emitAudio: (audio) => emitEvent("onTtsAudio", { audio }),
  });

  handle("isTtsAvailable", () => ttsAvailable());
  handle("setVoiceApiKey", ({ value }) => {
    // ui-state (the presence marker) is a server store — bound here.
    setVoiceApiKey(value, services.uiState, services.secrets);
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
      const samples = toFloat32Samples(payload);
      if (samples === null) {
        // Not audio at all — drop the chunk instead of feeding the recognizer
        // a garbage buffer. Stays inside this gated dispatch: sendSttAudio is
        // NOT remote-allowed, so a paired device never reaches here.
        console.error("[voice] ignoring non-binary audio chunk");
        return;
      }
      const events = pushAudio(samples);
      for (const ev of events) {
        emitEvent("onSttTranscript", ev);
      }
    } catch (err) {
      console.error("[voice] audio chunk handler failed:", err);
    }
  });

  handle("stopStt", () => stopSession());
}
