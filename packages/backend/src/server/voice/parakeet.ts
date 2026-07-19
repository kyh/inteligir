// ---------------------------------------------------------------------------
// Local on-device STT via sherpa-onnx + NeMo streaming Parakeet (English).
// Runs in the main process. Renderer pushes 16kHz mono PCM chunks via IPC.
// ---------------------------------------------------------------------------

import { join } from "node:path";

import { getModelDir, isModelInstalled } from "./model-download";
import { isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";

// sherpa-onnx-node is loaded lazily so the app still boots when the model
// isn't downloaded yet (the renderer just sees STT unavailable).
type OnlineRecognizerCtor = new (config: unknown) => {
  createStream: () => unknown;
  isReady: (stream: unknown) => boolean;
  decode: (stream: unknown) => void;
  getResult: (stream: unknown) => { text: string };
  isEndpoint: (stream: unknown) => boolean;
  reset: (stream: unknown) => void;
};

type Stream = {
  acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void;
  inputFinished: () => void;
};

function isOnlineRecognizerModule(value: unknown): value is {
  OnlineRecognizer: OnlineRecognizerCtor;
} {
  return isRecord(value) && typeof value.OnlineRecognizer === "function";
}

function isStream(value: unknown): value is Stream {
  return (
    isRecord(value) &&
    typeof value.acceptWaveform === "function" &&
    typeof value.inputFinished === "function"
  );
}

let recognizer: InstanceType<OnlineRecognizerCtor> | null = null;
let initPromise: Promise<InitResult> | null = null;
let stream: Stream | null = null;
let lastEmittedText = "";

export type ParakeetTranscript = { text: string; isFinal: boolean };

export type InitResult = { ok: true } | { ok: false; reason: string };

/**
 * Lazily constructs the OnlineRecognizer. Returns a discriminated result so
 * callers can distinguish "model missing" from "native module failed to load"
 * — the two have very different remediation steps.
 *
 * In-flight init is cached so concurrent calls don't double-load the ~140 MB
 * model. Cleared on completion (success or failure) so retries are possible.
 */
export async function initParakeet(): Promise<InitResult> {
  if (recognizer) return { ok: true };
  if (initPromise) return initPromise;
  initPromise = doInit().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

async function doInit(): Promise<InitResult> {
  if (!isModelInstalled()) {
    return { ok: false, reason: "Parakeet model not installed." };
  }

  const modelDir = getModelDir();

  try {
    const mod: unknown = await import("sherpa-onnx-node");
    if (!isOnlineRecognizerModule(mod)) {
      throw new Error("sherpa-onnx-node did not export OnlineRecognizer");
    }
    recognizer = new mod.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(modelDir, "encoder.onnx"),
          decoder: join(modelDir, "decoder.onnx"),
          joiner: join(modelDir, "joiner.onnx"),
        },
        tokens: join(modelDir, "tokens.txt"),
        numThreads: 2,
        provider: "cpu",
        modelType: "nemo_transducer",
        debug: false,
      },
      decodingMethod: "greedy_search",
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 0.8,
      rule3MinUtteranceLength: 20,
    });
    return { ok: true };
  } catch (err) {
    console.error("[parakeet] failed to load sherpa-onnx-node:", err);
    recognizer = null;
    return {
      ok: false,
      reason: `Failed to load sherpa-onnx native module: ${toErrorMessage(err)}`,
    };
  }
}

export function startSession(): void {
  if (!recognizer) return;
  const nextStream = recognizer.createStream();
  if (!isStream(nextStream)) {
    console.error("[parakeet] recognizer returned an invalid stream");
    return;
  }
  stream = nextStream;
  lastEmittedText = "";
}

/**
 * Push a 16kHz mono Float32 PCM chunk. Returns any new transcript events
 * produced (partial growth, or a final on endpoint).
 */
export function pushAudio(samples: Float32Array): ParakeetTranscript[] {
  if (!recognizer || !stream) return [];

  stream.acceptWaveform({ sampleRate: 16000, samples });

  const events: ParakeetTranscript[] = [];
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const text = recognizer.getResult(stream).text.trim();
  const endpoint = recognizer.isEndpoint(stream);

  if (endpoint) {
    if (text) events.push({ text, isFinal: true });
    recognizer.reset(stream);
    lastEmittedText = "";
  } else if (text && text !== lastEmittedText) {
    events.push({ text, isFinal: false });
    lastEmittedText = text;
  }

  return events;
}

/**
 * End the current session. Flushes any pending audio through the recognizer
 * and returns a final transcript for the tail-end utterance (the text since
 * the last endpoint) so the caller can route it to the agent — otherwise the
 * user's last words would be silently dropped.
 */
export function stopSession(): ParakeetTranscript[] {
  // Capture the stream reference at entry. If a new startSession() races us
  // (renderer fires stopStt + startStt back-to-back, IPC ordering not
  // guaranteed) and replaces the module-level `stream` before we finish, we
  // must NOT call inputFinished / null it on the new session's stream.
  const captured = stream;
  if (!recognizer || !captured) return [];

  captured.inputFinished();
  while (recognizer.isReady(captured)) {
    recognizer.decode(captured);
  }
  const text = recognizer.getResult(captured).text.trim();

  if (stream === captured) {
    stream = null;
    lastEmittedText = "";
  }

  return text ? [{ text, isFinal: true }] : [];
}
