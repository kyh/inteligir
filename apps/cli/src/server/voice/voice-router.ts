// the refusal switch is exhaustive, undeclared classes included (they rethrow): a fourth class
// is then a compile error at every route rather than a silent 500.

import { VOICE_MAX_AUDIO_BYTES } from "@repo/api/local/voice/voice-schema";
import { base } from "../orpc";
import { VoiceBusyError, VoiceTranscriptionError, VoiceUnavailableError } from "./voice-service";

type WriteRefusal =
  | { kind: "busy"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "transcription"; message: string };

function refusalFor(cause: unknown): WriteRefusal | null {
  if (cause instanceof VoiceBusyError) {
    return { kind: "busy", message: cause.message };
  }
  if (cause instanceof VoiceUnavailableError) {
    return { kind: "unavailable", message: cause.message };
  }
  if (cause instanceof VoiceTranscriptionError) {
    return { kind: "transcription", message: cause.message };
  }
  return null;
}

// base64 that decodes to an odd byte count is not int16 audio.
function decodePcm(base64: string): ArrayBuffer | null {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
    return null;
  }
  if (bytes.byteLength > VOICE_MAX_AUDIO_BYTES) {
    return null;
  }
  // copied out of the pool: Buffer.from shares a slab, and the samples are transferred into
  // the worker, which would detach the rest of it.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

const status = base.voice.status.handler(({ context }) => context.voice.status());

const install = base.voice.install.handler(async ({ context, errors }) => {
  try {
    return await context.voice.install();
  } catch (error) {
    const refusal = refusalFor(error);
    switch (refusal?.kind) {
      case "busy":
        throw errors.CONFLICT({ message: refusal.message });
      case "unavailable":
        throw errors.PROVIDER_UNAVAILABLE({ message: refusal.message });
      case "transcription":
      case undefined:
        throw error;
    }
  }
});

const remove = base.voice.remove.handler(({ context }) => context.voice.remove());

const transcribe = base.voice.transcribe.handler(async ({ context, input, errors }) => {
  const pcm = decodePcm(input.pcm);
  if (pcm === null) {
    throw errors.BAD_REQUEST({
      message: `Dictation audio must be 16-bit samples, at most ${VOICE_MAX_AUDIO_BYTES} bytes.`,
    });
  }
  try {
    return { text: await context.voice.transcribe(pcm) };
  } catch (error) {
    const refusal = refusalFor(error);
    switch (refusal?.kind) {
      case "busy":
        throw errors.CONFLICT({ message: refusal.message });
      case "unavailable":
      // a runtime that loaded then refused the clip is the same unusable capability to the caller.
      case "transcription":
        throw errors.PROVIDER_UNAVAILABLE({ message: refusal.message });
      case undefined:
        throw error;
    }
  }
});

export const voiceRouter = {
  status,
  install,
  remove,
  transcribe,
};
