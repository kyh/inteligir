// The voice routes. The service decides; this layer decodes the audio and
// says which refusal class each of its throws answers with.
//
// The switch over the refusal set is EXHAUSTIVE at every write, including the
// class a given row does not declare — that case rethrows into the generic
// 500, which is what makes "what does THIS route answer for it" a compile-time
// question when a fourth class arrives.

import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { VOICE_MAX_AUDIO_BYTES, voiceRoutes } from "@repo/server-contract/voice";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import {
  VoiceBusyError,
  VoiceTranscriptionError,
  VoiceUnavailableError,
  type VoiceService,
} from "./voice-service";

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

function unavailableBody(message: string): ApiErrorResponse {
  return { error: "provider_unavailable", message };
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

export function registerVoiceRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: VoiceService,
): void {
  const { get, post } = registrars;

  get(voiceRoutes.status, async (c) => c.json(await service.status()));

  post(voiceRoutes.install, async (c) => {
    try {
      return c.json(await service.install());
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "busy":
          return c.json({ error: "conflict", message: refusal.message }, API_ERROR_STATUS.conflict);
        case "unavailable":
          return c.json(unavailableBody(refusal.message), API_ERROR_STATUS.provider_unavailable);
        case "transcription":
        case undefined:
          throw error;
      }
    }
  });

  post(voiceRoutes.remove, async (c) => c.json(await service.remove()));

  post(voiceRoutes.transcribe, async (c, body) => {
    const pcm = decodePcm(body.pcm);
    if (pcm === null) {
      return c.json(
        {
          error: "invalid_request",
          message: `Dictation audio must be 16-bit samples, at most ${VOICE_MAX_AUDIO_BYTES} bytes.`,
        },
        API_ERROR_STATUS.invalid_request,
      );
    }
    try {
      return c.json({ text: await service.transcribe(pcm) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "busy":
          return c.json({ error: "conflict", message: refusal.message }, API_ERROR_STATUS.conflict);
        case "unavailable":
        // A runtime that loaded and then refused the clip is the same
        // unusable capability from the caller's side; the message tells them
        // apart, which is the split `connectors/routes.ts` already makes.
        case "transcription":
          return c.json(unavailableBody(refusal.message), API_ERROR_STATUS.provider_unavailable);
        case undefined:
          throw error;
      }
    }
  });
}
