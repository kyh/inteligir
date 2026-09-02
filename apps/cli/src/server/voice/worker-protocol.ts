// its own module: the worker is a separate bundle entry, and a type shared through the service
// would drag its import graph into the worker bundle.

export interface VoiceModelFiles {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export type VoiceWorkerRequest =
  // loads the native binding and nothing else, in a worker, so the main process pays nothing.
  { kind: "probe" } | { kind: "transcribe"; model: VoiceModelFiles; pcm: ArrayBuffer };

export type VoiceWorkerResponse =
  | { kind: "probed" }
  | { kind: "transcribed"; text: string }
  // modelUnusable: the model failed to open, so the caller nukes the files; a decode failure
  // keeps them.
  | { kind: "failed"; message: string; modelUnusable: boolean };

// the host annotates its literal against this so a mistyped kind cannot fall through to the
// one-shot path.
export interface VoiceStreamInit {
  kind: "stream";
  model: VoiceModelFiles;
}

export type VoiceStreamCommand = { kind: "audio"; pcm: ArrayBuffer } | { kind: "finalize" };

// one ready (or one failed), zero or more partial, then one final after a finalize.
export type VoiceStreamEvent =
  | { kind: "ready" }
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "failed"; message: string; modelUnusable: boolean };

export type VoiceWorkerData = VoiceWorkerRequest | VoiceStreamInit;
