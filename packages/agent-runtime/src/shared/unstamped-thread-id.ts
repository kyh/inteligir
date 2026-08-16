// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Upstream brands this constant with a unique-symbol type; the brand needs a
// type assertion to mint, which this repo forbids, so the plain constant is
// carried instead — the invariant lives in the comment and the stamping code.

// Adapter translations can be emitted before the runtime resolves the host
// thread. Runtime stamping must replace this before events leave agent-runtime.
export const UNSTAMPED_THREAD_ID = "";
