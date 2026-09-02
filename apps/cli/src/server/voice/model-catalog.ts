// one model, int8 (106 MB against 450 MB fp32), english only. the final has no punctuation or
// capitals; that is the accepted cost of streaming partials, not something to fix with whisper.
// recompute the digest with `curl -L <url> | shasum -a 256` when bumping.

export interface VoiceModelSpec {
  id: string;
  label: string;
  // of the archive, not the extracted files; the download refuses any other length.
  sizeBytes: number;
  sha256: string;
  url: string;
  // extracted flat into the model dir; the archive's top-level folder is stripped.
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
