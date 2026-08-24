// The voice handlers. The service decides; this layer decodes the audio and
// says which refusal class each of its throws answers with.
//
// The switch over the refusal set is EXHAUSTIVE at every write, including the
// class a given row does not declare — that case rethrows into the generic
// 500, which is what makes "what does THIS route answer for it" a compile-time
// question when a fourth class arrives.

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

/**
 * Base64 to samples. Zod already bounded the STRING, but base64 that decodes
 * to an odd number of bytes is not Int16 audio at all — half a sample would be
 * read as silence or as noise depending on what followed it in memory.
 */
function decodePcm(base64: string): ArrayBuffer | null {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
    return null;
  }
  if (bytes.byteLength > VOICE_MAX_AUDIO_BYTES) {
    return null;
  }
  // Copied out of the pool: Buffer.from shares a slab, and the samples are
  // TRANSFERRED into the worker, which would detach whatever else sits in it.
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
      // A runtime that loaded and then refused the clip is the same
      // unusable capability from the caller's side; the message tells them
      // apart, which is the split `connectors-router.ts` already makes.
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
