// sherpa-onnx-node ships no type declarations (upstream: k2-fsa/sherpa-onnx).
// Declared as `unknown` rather than hand-typed: `transcribe-worker.ts`
// validates the runtime shape at the import boundary, which is the only place
// this native module is touched.
declare module "sherpa-onnx-node" {
  const moduleExports: unknown;
  export = moduleExports;
}
