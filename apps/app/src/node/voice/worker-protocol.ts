// What the parent asks a transcription worker for, and what it gets back.
//
// Its own module because the WORKER imports it and so does the parent, and the
// worker is bundled as a separate entry — a type shared through the service
// would drag the service's whole import graph into the worker bundle.
//
// TWO SHAPES OVER ONE ENTRY. A one-shot worker (probe, or a whole-clip batch
// transcribe) takes its request as `workerData`, answers once, and exits. A
// STREAMING session takes `VoiceStreamInit` as `workerData`, loads the model
// once, and then trades messages for the life of a dictation hold — audio up,
// partials and one final down — before it is terminated. The engine
// (sherpa-onnx streaming Parakeet) is the same; only the lifecycle differs.

/** The four files sherpa-onnx loads, resolved to absolute paths by the host. */
export interface VoiceModelFiles {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export type VoiceWorkerRequest =
  /**
   * Load the native binding and say nothing else. This is how the server learns
   * that a platform has no usable runtime WITHOUT loading a model into the
   * process that owns the database and the watcher — the probe pays a worker
   * and the process pays nothing.
   */
  | { kind: "probe" }
  /** A whole clip. `pcm` is the format `@repo/server-contract/voice` names:
   *  little-endian Int16 samples, mono, 16 kHz. Fed through a stream in one
   *  shot; the answer is that stream's final. */
  | { kind: "transcribe"; model: VoiceModelFiles; pcm: ArrayBuffer };

export type VoiceWorkerResponse =
  | { kind: "probed" }
  | { kind: "transcribed"; text: string }
  /**
   * A sentence for a person; the worker never sends a stack. `modelUnusable`
   * is true when the failure was the MODEL failing to load (the files passed
   * the readiness check but sherpa-onnx could not open them) rather than the
   * audio failing to decode — the caller nukes the files on the former, because
   * the recovery primitive for the model cache is deleting it, and keeps them
   * on the latter, which is about the audio, not the bytes on disk.
   */
  | { kind: "failed"; message: string; modelUnusable: boolean };

/** `workerData` for a persistent streaming session. Not exported — callers pass
 *  it through {@link VoiceWorkerData}, and the worker reads it off `workerData`. */
interface VoiceStreamInit {
  kind: "stream";
  model: VoiceModelFiles;
}

/** Parent → streaming worker. */
export type VoiceStreamCommand =
  /** A PCM16 chunk (Int16 LE, mono, 16 kHz), transferred to the worker. */
  | { kind: "audio"; pcm: ArrayBuffer }
  /** Stop: flush the recognizer and answer one `final`. */
  | { kind: "finalize" };

/** Streaming worker → parent. Exactly one `ready` first (or one `failed`), then
 *  zero or more `partial`, then exactly one `final` after a `finalize`. */
export type VoiceStreamEvent =
  | { kind: "ready" }
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "failed"; message: string; modelUnusable: boolean };

/** Everything a voice worker can be started with. */
export type VoiceWorkerData = VoiceWorkerRequest | VoiceStreamInit;
