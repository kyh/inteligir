// The transcription worker: sherpa-onnx streaming Parakeet, off the process
// that owns the database and the watcher.
//
// WHY A WORKER AT ALL. The native decode holds the thread while it runs, and
// the process it would otherwise run in owns better-sqlite3 (whose every call
// is synchronous) and the file watcher's fork channel. A native call that holds
// the loop stalls a save, a query and the watcher's liveness ping together.
//
// TWO LIFECYCLES, ONE ENGINE. `workerData.kind === "stream"` enters the
// persistent session: load the recognizer ONCE, then trade messages — audio in,
// partials and one final out — until the host terminates the thread. Anything
// else is a one-shot (a probe, or a whole-clip batch transcribe) answered once
// before the worker exits. The model load is the expensive part (~0.7 s), which
// is exactly why a dictation hold gets a persistent worker rather than paying it
// per re-transcription.
//
// NOTHING HERE THROWS PAST THE MESSAGE. A native module that fails to load is
// the case the probe exists to report, so it must arrive as a sentence rather
// than as a worker `error` event carrying a stack — and a model that will not
// open is reported as `modelUnusable` so the cache can nuke it.
//
// THE PROBE ACTUALLY LOADS THE NATIVE BINDING. `import("sherpa-onnx-node")`
// requires the platform addon at load, so a platform whose binary cannot load
// (no prebuild, an ABI mismatch) throws here — which is what the probe exists to
// catch, rather than surfacing on the user's first real dictation.

// The ambient declaration for the untyped native module must ride along into
// this file's own program; a types-only reference is the only import style that
// loads a d.ts ambient module declaration without emitting a runtime import of
// the native addon.
// oxlint-disable-next-line typescript/triple-slash-reference -- see above
/// <reference path="./sherpa-onnx-node.d.ts" />

import { parentPort, workerData } from "node:worker_threads";
import { VOICE_SAMPLE_RATE } from "@repo/api/local/voice/voice-schema";
import { z } from "zod";
import type {
  VoiceModelFiles,
  VoiceStreamCommand,
  VoiceStreamEvent,
  VoiceWorkerData,
  VoiceWorkerResponse,
} from "./worker-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("transcribe-worker must be started as a worker thread");
}

/** Optional-chained because TS does not carry the null-guard above into the
 *  closures below; `port` is non-null by the time any of them runs. */
function post(reply: VoiceWorkerResponse | VoiceStreamEvent): void {
  port?.postMessage(reply);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text: string };
}

interface SherpaRecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string };
    tokens: string;
    numThreads: number;
    provider: string;
    modelType: string;
    debug: boolean;
  };
  decodingMethod: string;
  enableEndpoint: boolean;
}

interface OnlineRecognizerCtor {
  new (config: SherpaRecognizerConfig): SherpaRecognizer;
}

interface SherpaModule {
  OnlineRecognizer: OnlineRecognizerCtor;
}

// The addon is untyped, so its shape is PARSED at the import boundary with zod —
// the pattern `ws-bus.ts` uses for the transport it hijacks — rather than a
// hand-rolled typeof guard. `z.custom` passes the ORIGINAL object through, which
// keeps the native constructor bound to the module that owns it.
const sherpaModuleSchema = z.custom<SherpaModule>(
  (value) =>
    z
      .looseObject({ OnlineRecognizer: z.custom((member) => member instanceof Function) })
      .safeParse(value).success,
);

/** Load the addon, tolerating either CJS-interop shape (members on the
 *  namespace, or under `default`). Null when it exported no recognizer. */
async function importSherpa(): Promise<SherpaModule | null> {
  const mod: unknown = await import("sherpa-onnx-node");
  const direct = sherpaModuleSchema.safeParse(mod);
  if (direct.success) {
    return direct.data;
  }
  const nested = z.looseObject({ default: sherpaModuleSchema }).safeParse(mod);
  return nested.success ? nested.data.default : null;
}

/** Construct a recognizer for `model`. Throws on a load or open failure; the
 *  callers turn that into a `failed`/`modelUnusable` answer. */
async function loadRecognizer(model: VoiceModelFiles): Promise<SherpaRecognizer> {
  const sherpa = await importSherpa();
  if (sherpa === null) {
    throw new Error("sherpa-onnx-node did not export OnlineRecognizer");
  }
  const config: SherpaRecognizerConfig = {
    featConfig: { sampleRate: VOICE_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
      tokens: model.tokens,
      numThreads: 2,
      provider: "cpu",
      modelType: "nemo_transducer",
      debug: false,
    },
    decodingMethod: "greedy_search",
    // Endpointing OFF on purpose: dictation is push-to-talk, so the whole hold
    // is ONE utterance. Leaving it on would split the transcript on a pause and
    // reset the stream mid-hold, dropping earlier words from the growing text.
    enableEndpoint: false,
  };
  return new sherpa.OnlineRecognizer(config);
}

/** PCM16 (Int16 LE, mono, 16 kHz) → the Float32 sherpa's `acceptWaveform`
 *  wants, scaled into [-1, 1). */
function int16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const ints = new Int16Array(pcm);
  const floats = new Float32Array(ints.length);
  for (let index = 0; index < ints.length; index += 1) {
    floats[index] = (ints[index] ?? 0) / 0x8000;
  }
  return floats;
}

/** Feed samples, drain the decoder, and return the current transcript. */
function decodeInto(recognizer: SherpaRecognizer, stream: SherpaStream): string {
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }
  return recognizer.getResult(stream).text.trim();
}

async function runOneShot(request: VoiceWorkerData): Promise<VoiceWorkerResponse> {
  if (request.kind === "probe") {
    // The import forces the native load (see the header); a binding that cannot
    // load throws here, which is exactly what the probe exists to catch.
    if ((await importSherpa()) === null) {
      return { kind: "failed", message: "sherpa-onnx-node did not load", modelUnusable: false };
    }
    return { kind: "probed" };
  }
  if (request.kind === "stream") {
    // The stream lifecycle is handled elsewhere; a one-shot runner never sees
    // it. Answering rather than throwing keeps this exhaustive.
    return {
      kind: "failed",
      message: "stream init is not a one-shot request",
      modelUnusable: false,
    };
  }

  let recognizer: SherpaRecognizer;
  try {
    recognizer = await loadRecognizer(request.model);
  } catch (error) {
    // A model that will not open is a fact about the files on disk — nuke them.
    return { kind: "failed", message: message(error), modelUnusable: true };
  }
  try {
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: VOICE_SAMPLE_RATE, samples: int16ToFloat32(request.pcm) });
    stream.inputFinished();
    return { kind: "transcribed", text: decodeInto(recognizer, stream) };
  } catch (error) {
    // The model loaded; this is about the audio, so keep the files.
    return { kind: "failed", message: message(error), modelUnusable: false };
  }
}

/**
 * The persistent streaming session. Loads once, then handles commands in
 * arrival order — the native calls are synchronous, so a message handler that
 * never awaits after the load cannot overlap another, and the recognizer is
 * only ever touched by one command at a time.
 */
async function runStream(model: VoiceModelFiles): Promise<void> {
  const emit = (event: VoiceStreamEvent): void => post(event);
  let recognizer: SherpaRecognizer;
  let stream: SherpaStream;
  try {
    recognizer = await loadRecognizer(model);
    stream = recognizer.createStream();
  } catch (error) {
    emit({ kind: "failed", message: message(error), modelUnusable: true });
    return;
  }
  emit({ kind: "ready" });

  let lastPartial = "";
  let finished = false;
  port?.on("message", (command: VoiceStreamCommand) => {
    if (finished) {
      return;
    }
    try {
      if (command.kind === "audio") {
        stream.acceptWaveform({
          sampleRate: VOICE_SAMPLE_RATE,
          samples: int16ToFloat32(command.pcm),
        });
        const text = decodeInto(recognizer, stream);
        if (text !== "" && text !== lastPartial) {
          lastPartial = text;
          emit({ kind: "partial", text });
        }
      } else {
        finished = true;
        stream.inputFinished();
        emit({ kind: "final", text: decodeInto(recognizer, stream) });
      }
    } catch (error) {
      finished = true;
      emit({ kind: "failed", message: message(error), modelUnusable: false });
    }
  });
}

const data: VoiceWorkerData = workerData;
if (data.kind === "stream") {
  void runStream(data.model);
} else {
  runOneShot(data).then(
    (response) => post(response),
    (cause: unknown) => {
      // The only path here is the dynamic import itself throwing — a broken JS
      // wrapper — which is as unusable as a binding that will not load.
      post({ kind: "failed", message: message(cause), modelUnusable: true });
    },
  );
}
