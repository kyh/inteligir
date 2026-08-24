// The voice payload vocabulary: dictation, transcribed on this machine.
//
// THE MODEL FILE IS THE SWITCH. There is no `voiceEnabled` setting, for the
// reason `CLAUDE.md` already states about the device credential: two values
// that must agree are two values that can disagree, and both disagreements are
// bad — a flag off beside a downloaded model is dead weight nobody can reach,
// a flag on beside no model is a mic button that cannot work. So the status
// below is a fact about the filesystem, `install` fetches and `remove`
// deletes, and "off" is spelled "no model on disk".
//
// THE AUDIO IS PCM, DECLARED HERE RATHER THAN NEGOTIATED. sherpa-onnx wants
// 16 kHz mono, and the browser is the only side that can resample honestly (its
// `AudioContext` runs a real resampler against whatever the microphone
// produced). So the client converts once and the wire carries the one format
// this contract names; a `sampleRate` field would be a number the server cannot
// check and a client could get wrong.
//
// TWO PATHS OVER ONE FORMAT. The mic streams: a dedicated websocket
// (`VOICE_STREAM_PATH`) carries PCM16 frames UP as binary and `partial`/`final`
// /`error` messages DOWN — the streaming Parakeet recognizer emits partials as
// frames arrive and one final on release. The batch procedure (`transcribe`)
// STAYS for a whole-clip caller (scripted mode, any non-interactive path): it
// travels BASE64 IN A JSON BODY, bounded by the cap below. Both feed the same
// engine — the batch path pushes the whole clip through a stream and reads its
// final.

import { z } from "zod";

/** What sherpa-onnx reads: mono, signed 16-bit little-endian, 16 kHz. */
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_BYTES_PER_SAMPLE = 2;

/**
 * The ceiling on ONE dictation. Two minutes is far past a spoken composer
 * message and bounds the batch request body — and it is the same cap the
 * streaming session enforces on a long hold (`stream-session.ts`), so a
 * runaway microphone cannot grow the recognizer's state without limit.
 */
export const VOICE_MAX_AUDIO_SECONDS = 120;
export const VOICE_MAX_AUDIO_BYTES =
  VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE * VOICE_MAX_AUDIO_SECONDS;
/** Base64 is 4 characters per 3 bytes, rounded up to the padded quantum. */
export const VOICE_MAX_AUDIO_BASE64_LENGTH = Math.ceil(VOICE_MAX_AUDIO_BYTES / 3) * 4;

/**
 * The model this install dictates with — served rather than compiled into the
 * surface, so the download button can state the size before it spends it.
 */
export const voiceModelSchema = z
  .object({
    id: z.string().min(1),
    /** What to call it to a person, e.g. "Parakeet streaming (English)". */
    label: z.string().min(1),
    /** Exact, from the catalog's pin — not a Content-Length the server was told. */
    sizeBytes: z.number().int().min(1),
  })
  .strict();
export type VoiceModel = z.infer<typeof voiceModelSchema>;

/**
 * Whether this machine can dictate, and if not, what it is missing. Four
 * states and no other combination is expressible: a download in flight always
 * has a byte count, and only `no-model` can carry the reason the last attempt
 * failed.
 *
 * `unavailable` is the transcription runtime refusing to load at all — a
 * platform with no prebuilt binary, or a macOS older than the one it was built
 * against. It is an ANSWER, in the shape the connectors listing and the agent
 * block already use, because "this machine cannot" is an answer to the
 * question rather than a failure to answer it.
 */
export const voiceStatusResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unavailable"), detail: z.string().min(1) }).strict(),
  z
    .object({
      state: z.literal("no-model"),
      model: voiceModelSchema,
      /** Why the last install stopped, or null if none was ever tried. */
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
  /**
   * The bytes are on disk and a warm-up is loading the model once — sherpa-onnx
   * opens the four onnx files and brings up onnxruntime's session. Its own state
   * because it is where a model that passed the size/digest gate but cannot be
   * OPENED is caught, at the install the user is already watching rather than at
   * their first dictation. It is short (~a second).
   */
  z.object({ state: z.literal("preparing"), model: voiceModelSchema }).strict(),
  z.object({ state: z.literal("ready"), model: voiceModelSchema }).strict(),
]);
export type VoiceStatusResponse = z.infer<typeof voiceStatusResponseSchema>;

/**
 * One dictation's audio. `pcm` is base64 of the sample bytes — nothing else,
 * no container and no header, because a header is a second place the format
 * could be stated and the two could disagree.
 */
export const voiceTranscribeRequestSchema = z
  .object({
    pcm: z.base64().max(VOICE_MAX_AUDIO_BASE64_LENGTH),
  })
  .strict();
export type VoiceTranscribeRequest = z.infer<typeof voiceTranscribeRequestSchema>;

/**
 * What was said. Empty when the clip held no speech — silence is a legitimate
 * recording, so it answers with nothing rather than refusing, and the surface
 * says "nothing was said" instead of showing a failure.
 */
export const voiceTranscribeResponseSchema = z.object({ text: z.string() }).strict();
export type VoiceTranscribeResponse = z.infer<typeof voiceTranscribeResponseSchema>;

// ---------------------------------------------------------------------------
// The dictation stream.
//
// A websocket, NOT a contract row, for the reason `/ws` states its own: a
// websocket is not a request/response pair, and no typed client derives from
// it. It rides its OWN endpoint rather than the invalidation bus, because that
// bus carries change-kind PINGS by decision and never a payload — and this
// carries audio up and transcripts down. It sits behind the SAME device-token
// gate the `/ws` upgrade does; its path is `@repo/api/local/routes`'s.
//
// The grammar is asymmetric on purpose. FRAMES GO UP AS BINARY (PCM16, the
// format above), because base64 in a text frame would inflate every 128 ms
// chunk by a third for no gain a JSON envelope buys back. CONTROL GOES UP AS
// TEXT (`finalize`), and everything DOWN is text — the transcripts are small
// and JSON keeps them self-describing. Cancelling is closing the socket: there
// is nothing to say, and a client that vanished says it the same way.
// ---------------------------------------------------------------------------

/**
 * The largest single binary frame the stream accepts. A capture pushing ~128 ms
 * per frame is nowhere near this; one whole second of PCM16 is the ceiling, so
 * a frame past it is a misbehaving or hostile client and is dropped rather than
 * fed to the recognizer.
 */
export const VOICE_STREAM_FRAME_MAX_BYTES = VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE;

/**
 * Client → server control. Binary frames (the PCM16 audio) are NOT described
 * here — they are raw bytes, validated by length, not by a schema. This is only
 * the text control channel, a discriminated union so a second verb is one row.
 */
export const voiceStreamUpMessageSchema = z.discriminatedUnion("type", [
  /** Stop capturing: transcribe what has been fed and answer one `final`. */
  z.object({ type: z.literal("finalize") }).strict(),
]);
export type VoiceStreamUpMessage = z.infer<typeof voiceStreamUpMessageSchema>;

/**
 * Server → client. Partials REWRITE as more audio arrives — inherent to every
 * streaming recognizer, expected rather than a defect — and exactly one `final`
 * or one `error` ends the session; the server closes the socket after either.
 */
export const voiceStreamDownMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("partial"), text: z.string() }).strict(),
  z.object({ type: z.literal("final"), text: z.string() }).strict(),
  z.object({ type: z.literal("error"), message: z.string().min(1) }).strict(),
]);
export type VoiceStreamDownMessage = z.infer<typeof voiceStreamDownMessageSchema>;
