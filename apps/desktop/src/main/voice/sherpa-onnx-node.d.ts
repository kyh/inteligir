// sherpa-onnx-node ships no type declarations (upstream: k2-fsa/sherpa-onnx).
// Declared as `unknown` rather than hand-typed: parakeet.ts validates the
// runtime shape at the import boundary via isOnlineRecognizerModule.
declare module "sherpa-onnx-node" {
  const moduleExports: unknown;
  export = moduleExports;
}
