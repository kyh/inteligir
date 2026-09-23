// its own module: the worker is a separate bundle entry, and a type shared through the service
// would drag its import graph into the worker bundle. types only, never schemas: a runner without
// tsx (vitest) loads the worker's .ts source through node's own type stripping, which erases a
// type import but cannot resolve an extensionless relative one. a frame crosses as `any`, so
// each side parses what it receives with a schema pinned to these types.

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
