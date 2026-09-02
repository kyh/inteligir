// sherpa-onnx-node ships no types. unknown rather than hand-typed: transcribe-worker.ts
// validates the runtime shape at the import boundary.
declare module "sherpa-onnx-node" {
  const moduleExports: unknown;
  export = moduleExports;
}
