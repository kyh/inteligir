// extends Cloudflare.Env (what `env` is typed as), not the deprecated
// ProvidedEnv; no top-level import, so the namespace merges globally

declare namespace Cloudflare {
  interface Env {
    TEST_SCHEMA: string;
    // injected by vitest.config.ts's miniflare.bindings
    BETTER_AUTH_SECRET: string;
    RATE_LIMIT_DISABLED: string;
  }
}
