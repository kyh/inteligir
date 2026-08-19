// THE model dictation runs on, pinned by size and digest.
//
// ONE MODEL, not a picker. `ggml-tiny.en-q5_1` measured 94 ms on a 9.5 s
// dictation and 513 ms on a full minute against 185 MB of peak RSS, off a
// 32 MB download; `base.en-q5_1` costs 1.5x the latency and 60 MB for a
// transcript that differed on the measurement fixtures by one plural. A second
// entry would also mean a second control in Settings beside the switch, and
// the two can disagree — a model chosen but not downloaded is a state the
// switch alone cannot have.
//
// ENGLISH-ONLY, deliberately. The `.en` models are the accurate ones for
// dictation and the multilingual pair costs the same bytes for worse English.
// A language setting is the change to make when someone asks for one.
//
// THE DIGEST IS THE POINT of pinning `main` rather than a revision. The
// download is bytes fetched over the network and written to disk where a
// native runtime will mmap them, so it is verified before it is installed; a
// mirror that moved, a truncated response and a hostile proxy all fail the
// same check.

export interface VoiceModelSpec {
  /** Names the directory under the model dir, so it is also the cache key. */
  id: string;
  label: string;
  /** Exact byte count — the download refuses anything else. */
  sizeBytes: number;
  /** sha-256 of the model file, lowercase hex. */
  sha256: string;
  url: string;
}

export const VOICE_MODEL: VoiceModelSpec = {
  id: "ggml-tiny.en-q5_1",
  label: "Whisper tiny (English)",
  sizeBytes: 32_166_155,
  sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
};

/** What the scripted runtime reports, so a harness sees the same shape a real
 *  install does without a download. */
export const SCRIPTED_VOICE_MODEL: VoiceModelSpec = {
  id: "scripted",
  label: "Scripted (test runtime)",
  sizeBytes: 1,
  sha256: "",
  url: "",
};
