// Shared constants for the Parakeet STT model. Imported by both the runtime
// downloader (model-download.ts) and the dev pre-warm script
// (scripts/download-stt-model.mjs) so they can't drift apart.

export const MODEL_NAME = "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-24500";
export const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
