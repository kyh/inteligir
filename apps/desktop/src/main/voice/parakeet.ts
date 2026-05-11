// ---------------------------------------------------------------------------
// Local on-device STT via sherpa-onnx + NeMo streaming Parakeet (English).
// Runs in the main process. Renderer pushes 16kHz mono PCM chunks via IPC.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join } from "node:path";

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

const MODEL_NAME = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-24500";

let recognizer: InstanceType<OnlineRecognizerCtor> | null = null;
let stream: Stream | null = null;
let lastEmittedText = "";

export type ParakeetTranscript = { text: string; isFinal: boolean };

export type InitResult = { ok: true } | { ok: false; reason: string };

function resolveModelDir(projectRoot: string): string {
  return join(projectRoot, "resources", "stt", MODEL_NAME);
}

export function isModelInstalled(projectRoot: string): boolean {
  const dir = resolveModelDir(projectRoot);
  return existsSync(join(dir, "tokens.txt"));
}

/**
 * Lazily constructs the OnlineRecognizer. Returns a discriminated result so
 * callers can distinguish "model missing" from "native module failed to load"
 * — the two have very different remediation steps.
 */
export async function initParakeet(projectRoot: string): Promise<InitResult> {
  if (recognizer) return { ok: true };
  if (!isModelInstalled(projectRoot)) {
    const reason =
      "Parakeet model not installed. Run 'pnpm download-stt-model' in apps/desktop.";
    console.warn(`[parakeet] ${reason}`);
    return { ok: false, reason };
  }

  const modelDir = resolveModelDir(projectRoot);

  try {
    const mod = (await import("sherpa-onnx-node")) as unknown as {
      OnlineRecognizer: OnlineRecognizerCtor;
    };
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
      reason: `Failed to load sherpa-onnx native module: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function startSession(): void {
  if (!recognizer) return;
  stream = recognizer.createStream() as Stream;
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

export function stopSession(): void {
  stream = null;
  lastEmittedText = "";
}
