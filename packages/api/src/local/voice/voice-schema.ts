// the model file is the switch: no `voiceEnabled` flag, because a flag and a file can disagree.
// the format is declared, not negotiated: the browser is the only side that can resample
// honestly, and a `sampleRate` field is a number the server cannot check.

import { z } from "zod";

// what sherpa-onnx reads: mono, signed 16-bit little-endian, 16 khz.
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_BYTES_PER_SAMPLE = 2;

// the cap the streaming session enforces on a long hold.
export const VOICE_MAX_AUDIO_SECONDS = 120;

export const voiceModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    // from the catalog's pin, not a content-length.
    sizeBytes: z.number().int().min(1),
  })
  .strict();
export type VoiceModel = z.infer<typeof voiceModelSchema>;

export const voiceStatusResponseSchema = z.discriminatedUnion("state", [
  // the native runtime cannot load on this machine (no prebuilt binary, or too old a macos).
  z.object({ state: z.literal("unavailable"), detail: z.string().min(1) }).strict(),
  z
    .object({
      state: z.literal("no-model"),
      model: voiceModelSchema,
      lastError: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      state: z.literal("downloading"),
      model: voiceModelSchema,
      receivedBytes: z.number().int().min(0),
    })
    .strict(),
  // loading the model once after download, so a model that passed the digest gate but cannot
  // be opened is caught at install rather than at first dictation.
  z.object({ state: z.literal("preparing"), model: voiceModelSchema }).strict(),
  z.object({ state: z.literal("ready"), model: voiceModelSchema }).strict(),
]);
export type VoiceStatusResponse = z.infer<typeof voiceStatusResponseSchema>;

// the dictation stream is its own websocket, off the /ws bus (which carries pings, never a
// payload). audio goes up as binary frames (base64 would inflate every 128 ms chunk by a third);
// control and transcripts are text. cancelling is closing the socket.

// one second of pcm16; a frame past it is a misbehaving client and is dropped.
export const VOICE_STREAM_FRAME_MAX_BYTES = VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE;

// text control only; the audio frames are raw binary validated by length.
export const voiceStreamUpMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("finalize") }).strict(),
]);
export type VoiceStreamUpMessage = z.infer<typeof voiceStreamUpMessageSchema>;

// partials rewrite as audio arrives; one `final` or one `error` ends the session and the server
// closes the socket.
export const voiceStreamDownMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("partial"), text: z.string() }).strict(),
  z.object({ type: z.literal("final"), text: z.string() }).strict(),
  z.object({ type: z.literal("error"), message: z.string().min(1) }).strict(),
]);
export type VoiceStreamDownMessage = z.infer<typeof voiceStreamDownMessageSchema>;
