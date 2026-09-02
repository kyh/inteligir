// a worker: the native decode holds the thread, and the main process owns better-sqlite3 (every
// call synchronous) and the watcher's liveness ping. nothing here throws past the message: a
// binding that cannot load must arrive as a sentence, not a worker error event with a stack.
// import("sherpa-onnx-node") requires the platform addon, so the probe loads the binding for real.

// a types-only reference is the only import style that loads the ambient d.ts without emitting
// a runtime import of the addon.
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
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from "./worker-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("transcribe-worker must be started as a worker thread");
}

// optional-chained: ts does not carry the null guard above into the closures.
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

// z.custom passes the original object through, keeping the native constructor bound to its module.
const sherpaModuleSchema = z.custom<SherpaModule>(
  (value) =>
    z
      .looseObject({ OnlineRecognizer: z.custom((member) => member instanceof Function) })
      .safeParse(value).success,
);

async function importSherpa(): Promise<SherpaModule | null> {
  const mod: unknown = await import("sherpa-onnx-node");
  const direct = sherpaModuleSchema.safeParse(mod);
  if (direct.success) {
    return direct.data;
  }
  const nested = z.looseObject({ default: sherpaModuleSchema }).safeParse(mod);
  return nested.success ? nested.data.default : null;
}

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
    // endpointing off: dictation is push-to-talk, so the hold is one utterance. on, a pause
    // would split the transcript and reset the stream mid-hold, dropping earlier words.
    enableEndpoint: false,
  };
  return new sherpa.OnlineRecognizer(config);
}

function int16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const ints = new Int16Array(pcm);
  const floats = new Float32Array(ints.length);
  for (let index = 0; index < ints.length; index += 1) {
    floats[index] = (ints[index] ?? 0) / 0x8000;
  }
  return floats;
}

function decodeInto(recognizer: SherpaRecognizer, stream: SherpaStream): string {
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }
  return recognizer.getResult(stream).text.trim();
}

async function runOneShot(request: VoiceWorkerRequest): Promise<VoiceWorkerResponse> {
  if (request.kind === "probe") {
    if ((await importSherpa()) === null) {
      return { kind: "failed", message: "sherpa-onnx-node did not load", modelUnusable: false };
    }
    return { kind: "probed" };
  }

  let recognizer: SherpaRecognizer;
  try {
    recognizer = await loadRecognizer(request.model);
  } catch (error) {
    // a model that will not open is a fact about the files on disk.
    return { kind: "failed", message: message(error), modelUnusable: true };
  }
  try {
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: VOICE_SAMPLE_RATE, samples: int16ToFloat32(request.pcm) });
    stream.inputFinished();
    return { kind: "transcribed", text: decodeInto(recognizer, stream) };
  } catch (error) {
    // the model loaded; this is about the audio.
    return { kind: "failed", message: message(error), modelUnusable: false };
  }
}

// the native calls are synchronous and the handler never awaits after the load, so commands
// cannot overlap.
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
      // only the dynamic import itself throwing lands here: a broken js wrapper is as unusable
      // as a binding that will not load.
      post({ kind: "failed", message: message(cause), modelUnusable: true });
    },
  );
}
