// The Workers pool types `cloudflare:test`'s `env` as `Cloudflare.Env` (already
// derived from the wrangler.jsonc bindings), so we extend THAT — not the
// deprecated `ProvidedEnv` — with the test-only `TEST_SCHEMA` binding that
// vitest.config.ts injects (the D1 schema DDL exported from src/worker/db/schema.ts). No
// top-level import keeps this an ambient script so the `Cloudflare` namespace
// merges globally.
declare namespace Cloudflare {
  interface Env {
    TEST_SCHEMA: string;
    // Also injected by vitest.config.ts (see its `miniflare.bindings`), and
    // needed statically when a test rebuilds a full `Env` around `env` (the
    // password-reset tests swap in a mock EMAIL binding that way).
    BETTER_AUTH_SECRET: string;
    RATE_LIMIT_DISABLED: string;
  }
}
