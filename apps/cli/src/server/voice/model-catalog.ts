// THE model dictation runs on, pinned by size and digest.
//
// STREAMING PARAKEET (issue #578), restored from before the rewrite. The model
// is NeMo's streaming fast-conformer transducer (English), run by sherpa-onnx:
// it emits partials as audio arrives and a final on release, which is the whole
// point of the feature — the words appear as you speak. The tradeoff is stated
// in `CLAUDE.md`: the final has no punctuation and no capitalization. That is
// inherent to this model and is NOT to be "fixed" by bolting whisper back on;
// #574 already made that trade the other way and lost the live partials.
//
// ONE MODEL, not a picker — a second entry means a second control in Settings
// beside the switch, and the two can disagree (a model chosen but not
// downloaded is a state the switch alone cannot have).
//
// THE int8 VARIANT, not fp32: a 106 MB download against 450 MB for a transcript
// that differs only marginally, and the whole reason the one-model path was
// chosen is size. ENGLISH-ONLY — a language setting is the change to make when
// someone asks for one.
//
// THE DIGEST IS THE POINT of pinning the release archive. The download is bytes
// fetched over the network, extracted, and mmapped by a native runtime, so it
// is verified before it is installed; a mirror that moved, a truncated response
// and a hostile proxy all fail the same check. Recompute via
// `curl -L <url> | shasum -a 256` when bumping the model.

export interface VoiceModelSpec {
  /** Names the directory under the model dir, so it is also the cache key. */
  id: string;
  label: string;
  /** Exact byte count of the DOWNLOAD ARCHIVE — the download refuses anything
   *  else, and the status surfaces it as the size a person is about to spend. */
  sizeBytes: number;
  /** sha-256 of the archive, lowercase hex. */
  sha256: string;
  /** The release archive (`.tar.bz2`) the four model files are extracted from. */
  url: string;
  /**
   * The files sherpa-onnx loads, by role. Extracted flat into the model's own
   * directory (the archive's top-level folder is stripped), so readiness is
   * "all four present and non-empty" and the recognizer config joins these
   * names onto the model dir.
   */
  files: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
  };
}

export const VOICE_MODEL: VoiceModelSpec = {
  id: "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8",
  label: "Parakeet streaming (English)",
  sizeBytes: 105_913_204,
  sha256: "da93061cbf7b708b6b65976f70b29f519be29df750d8cdcabf98c65645930f13",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8.tar.bz2",
  files: {
    encoder: "encoder.int8.onnx",
    decoder: "decoder.int8.onnx",
    joiner: "joiner.int8.onnx",
    tokens: "tokens.txt",
  },
};
