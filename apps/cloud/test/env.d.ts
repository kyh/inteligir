// The Workers pool types `cloudflare:test`'s `env` as `Cloudflare.Env` (already
// derived from the wrangler.jsonc bindings), so we extend THAT — not the
// deprecated `ProvidedEnv` — with the test-only `TEST_SCHEMA` binding that
// vitest.config.ts injects (the D1 schema DDL exported from src/db/schema.ts). No
// top-level import keeps this an ambient script so the `Cloudflare` namespace
// merges globally.
declare namespace Cloudflare {
  interface Env {
    TEST_SCHEMA: string;
  }
}
