// ---------------------------------------------------------------------------
// The two voice upstreams, and nothing else.
//
// Everything policy-shaped — the chunking cadence, the epoch guard, the partial
// budget, the caps — lives in the sessions beside this file, which is what lets
// those be tested without an ElevenLabs account or a Workers AI binding. What
// is here is purely "how the vendor's wire looks", the same split
// ../agent/cf-sandbox keeps against ../agent/fake-sandbox.
//
// TTS IS ELEVENLABS deliberately. Workers AI offers `@cf/deepgram/aura-1` and it
// would be one fewer credential, but which voice the product speaks with is a
// product decision rather than an implementation detail, and the key is already
// a thing users configure. So the choice is explicit rather than defaulted: a
// deployment with no ElevenLabs key has NO text-to-speech (`isTtsAvailable`
// answers false and the read-aloud command hides), rather than a different
// voice nobody asked for.
// ---------------------------------------------------------------------------

import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";

import { bytesToBase64 } from "../host/vault/base64";
import type { SttTranscriber } from "./stt-session";
import type { TtsSynthesizer } from "./tts-session";

/** The voice the deployment speaks with when it names none. */
const DEFAULT_VOICE_ID = "SAz9YHcvj6GT2YYXdXww";

/** ElevenLabs' lowest-latency model. Latency is the whole constraint here: the
 * first audio has to arrive while the user is still reading the sentence. */
const TTS_MODEL_ID = "eleven_flash_v2_5";

/**
 * The audio format asked for, and the one contract the client depends on:
 * raw 24 kHz signed 16-bit little-endian PCM, which its AudioContext plays
 * frame by frame with no decoding. Changing it here without changing the
 * client produces noise, not an error.
 */
const TTS_OUTPUT_FORMAT = "pcm_24000";

/** The speech model. See ./stt-session's header for why this one and not the
 * realtime WebSocket alternatives. */
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";

export type ElevenLabsDeps = {
  /** The user's key, read per chunk so one saved mid-session takes effect. */
  readonly apiKey: () => Promise<string | null>;
  /** Bound rather than passed bare: `fetch` on workerd is an unbound global. */
  readonly fetch: typeof fetch;
  /** The voice id this deployment speaks with. */
  readonly voiceId: string | undefined;
};

/** Synthesize over ElevenLabs' streaming HTTP endpoint. The response body is
 * read incrementally so the first audio reaches the client before the last word
 * has been generated, and it is one REQUEST — an upstream socket would pin the
 * object between utterances. */
export function createElevenLabsSynthesizer(deps: ElevenLabsDeps): TtsSynthesizer {
  return async (text, signal, onAudio) => {
    const apiKey = await deps.apiKey();
    if (apiKey === null) return { ok: false, error: "No ElevenLabs key is configured." };
    const voiceId =
      deps.voiceId !== undefined && deps.voiceId !== "" ? deps.voiceId : DEFAULT_VOICE_ID;

    let response: Response;
    try {
      response = await deps.fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
          `?output_format=${TTS_OUTPUT_FORMAT}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "xi-api-key": apiKey },
          body: JSON.stringify({ text, model_id: TTS_MODEL_ID }),
          signal,
        },
      );
    } catch (error) {
      return { ok: false, error: toErrorMessage(error, "ElevenLabs could not be reached.") };
    }
    if (!response.ok) {
      return { ok: false, error: `ElevenLabs refused the request (${response.status}).` };
    }
    const body = response.body;
    if (body === null) return { ok: false, error: "ElevenLabs returned no audio." };

    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined && value.length > 0) onAudio(value);
      }
    } catch (error) {
      return { ok: false, error: toErrorMessage(error, "The audio stream ended early.") };
    } finally {
      reader.releaseLock();
    }
    return { ok: true };
  };
}

/**
 * Transcribe over Workers AI's REST endpoint, or `null` when this deployment
 * configured no account for it.
 *
 * REST RATHER THAN THE `ai` BINDING, and the reason is the test suite. A
 * declared Workers AI binding has no local implementation, so
 * `@cloudflare/vitest-pool-workers` opens a REMOTE connection at pool startup —
 * which makes a Cloudflare API credential a prerequisite for running any test
 * in this package, including the 130-odd that never go near a model. Over
 * `fetch` the credential is needed only by the code that actually calls the
 * model, which is the same both-or-nothing account configuration Browser Run
 * already uses (see ../env.d.ts).
 */
export function createWorkersAiTranscriber(
  env: Env,
  fetchImpl: typeof fetch,
): SttTranscriber | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.WORKERS_AI_API_TOKEN;
  if (accountId === undefined || token === undefined || accountId === "" || token === "") {
    return null;
  }
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
    `/ai/run/${STT_MODEL}`;
  return async (wav) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          audio: bytesToBase64(wav),
          task: "transcribe",
          // Silence is most of a dictation buffer, and whisper hallucinates
          // into it — the filter is what keeps a pause becoming a sentence.
          vad_filter: true,
          condition_on_previous_text: false,
        }),
      });
    } catch (error) {
      return { ok: false, error: toErrorMessage(error, "Workers AI could not be reached.") };
    }
    if (!response.ok) {
      return { ok: false, error: `Workers AI refused the request (${response.status}).` };
    }
    try {
      return { ok: true, text: readTranscription(await response.json()) };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error, "The transcription could not be read.") };
    }
  };
}

/** The `result.text` of a Workers AI REST reply, or `""` when it carried none —
 * a value, because silence transcribing to nothing is the ordinary case. */
function readTranscription(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const result = payload["result"];
  if (!isRecord(result)) return "";
  const text = result["text"];
  return typeof text === "string" ? text : "";
}
