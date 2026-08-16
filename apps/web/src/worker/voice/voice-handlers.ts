// ---------------------------------------------------------------------------
// Voice's eight Bridge handlers, over this object's own sessions.
//
// The three `send`-kind channels (`ttsSend`, `ttsFlush`, `ttsInterrupt`) are
// fire-and-forget by registry contract, so nothing here may throw past the
// dispatcher — the sessions answer with values and the deferral seam owns the
// work that outlives the frame.
//
// There is no channel for a local speech MODEL, and there never will be: both
// upstreams are services this object calls over HTTP, and there is no per-user
// writable disk and no local inference to report the state of.
// ---------------------------------------------------------------------------

import type { HandlerRegistrar } from "../host/handler-registry";
import { toFloat32Samples } from "./wav";
import type { VoiceComposition } from "./voice-composition";

export function registerVoiceHandlers(handle: HandlerRegistrar, voice: VoiceComposition): void {
  handle("isTtsAvailable", () => voice.secret.present());
  handle("setVoiceApiKey", ({ value }) => voice.secret.set(value));

  handle("ttsSend", ({ text }) => {
    voice.tts.send(text);
  });
  handle("ttsFlush", () => {
    voice.tts.flush();
  });
  handle("ttsInterrupt", () => {
    voice.tts.interrupt();
  });

  handle("startStt", () => voice.stt.start());
  handle("sendSttAudio", (payload) => {
    const samples = toFloat32Samples(payload);
    // Not audio at all — drop the frame rather than feed the model a buffer of
    // whatever a peer encoded. The registry types this channel `unknown`, so
    // proving the shape is this handler's job (see ./wav).
    if (samples === null) return;
    voice.stt.push(samples);
  });
  handle("stopStt", () => voice.stt.stop());
}
