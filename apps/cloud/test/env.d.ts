// The Workers pool types `cloudflare:test`'s `env` as `Cloudflare.Env` (already
// derived from the wrangler.jsonc bindings), so we extend THAT — not the
// deprecated `ProvidedEnv` — with the test-only `TEST_MIGRATIONS` binding that
// vitest.config.ts injects (the D1 migration SQL). No top-level import keeps this
// an ambient script so the `Cloudflare` namespace merges globally.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
