// ---------------------------------------------------------------------------
// Where the voice parts are put together — one object's worth, never a module's.
//
// Every field below is per-instance for the reason ./tts-session states at
// length: a Worker isolate serves many tenants' Durable Objects, and this
// capability moves the user's NOTE TEXT through a third party and their spoken
// words back. Module scope here is a cross-tenant leak, not a performance
// question.
// ---------------------------------------------------------------------------

import type { UiState } from "@repo/bridge/ui-state";
import type { JsonStoreCore } from "../store/json-store-core";

import { SttSession, type SttTranscript } from "./stt-session";
import { TtsSession } from "./tts-session";
import { createElevenLabsSynthesizer, createWorkersAiTranscriber } from "./voice-upstreams";
import { VoiceSecret } from "./voice-secret";

export type VoiceCompositionDeps = {
  readonly env: Env;
  readonly userId: string;
  readonly kv: ConstructorParameters<typeof VoiceSecret>[0]["kv"];
  readonly uiState: JsonStoreCore<UiState>;
  /** Push one PCM frame (`onTtsAudio`, a binary channel). */
  readonly emitAudio: (pcm: Uint8Array) => void;
  /** Push one interim transcript (`onSttTranscript`). */
  readonly emitTranscript: (transcript: SttTranscript) => void;
  /** Work the object must not be evicted before finishing — `ctx.waitUntil`. */
  readonly defer: (work: Promise<unknown>) => void;
};

export type VoiceComposition = {
  readonly secret: VoiceSecret;
  readonly tts: TtsSession;
  readonly stt: SttSession;
};

export function composeVoice(deps: VoiceCompositionDeps): VoiceComposition {
  const secret = new VoiceSecret({
    kv: deps.kv,
    uiState: deps.uiState,
    userId: deps.userId,
    secret: deps.env.BETTER_AUTH_SECRET,
  });

  const tts = new TtsSession({
    synthesize: createElevenLabsSynthesizer({
      apiKey: () => secret.read(),
      fetch: (input, init) => fetch(input, init),
      voiceId: deps.env.ELEVENLABS_VOICE_ID,
    }),
    emitAudio: deps.emitAudio,
    defer: deps.defer,
    available: () => secret.present(),
  });

  // A deployment with no Workers AI account gets a transcriber that refuses
  // rather than a session that swallows audio: `startStt` answers the sentence
  // and the renderer never opens a microphone.
  const transcriber = createWorkersAiTranscriber(deps.env, (input, init) => fetch(input, init));
  const stt = new SttSession({
    transcribe:
      transcriber ??
      (() =>
        Promise.resolve({
          ok: false as const,
          error: "This deployment has no speech-recognition binding.",
        })),
    emitTranscript: deps.emitTranscript,
    defer: deps.defer,
    available: () => transcriber !== null,
  });

  return { secret, tts, stt };
}
