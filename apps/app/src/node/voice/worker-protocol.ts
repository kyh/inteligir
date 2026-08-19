// What the parent asks a transcription worker for, and what it gets back.
//
// Its own module because the WORKER imports it and so does the parent, and the
// worker is bundled as a separate entry — a type shared through the service
// would drag the service's whole import graph into the worker bundle.

export type VoiceWorkerRequest =
  /**
   * Load the native binding and say nothing else. This is how the server
   * learns that a platform has no usable runtime WITHOUT dlopening Metal, a
   * Vulkan loader or a CUDA stub into the process that owns the database and
   * the watcher — the probe pays a worker and the process pays nothing.
   */
  | { kind: "probe" }
  /** `pcm` is the format `@repo/server-contract/voice` names, as the native
   *  binding wants it: little-endian Int16 samples, mono, 16 kHz. */
  | { kind: "transcribe"; modelPath: string; pcm: ArrayBuffer };

export type VoiceWorkerResponse =
  | { kind: "probed" }
  | { kind: "transcribed"; text: string }
  /** A sentence for a person; the worker never sends a stack. */
  | { kind: "failed"; message: string };
