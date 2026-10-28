// extends Cloudflare.Env (what `env` is typed as) with the one binding only the suites declare;
// no top-level import, so the namespace merges globally

declare namespace Cloudflare {
  interface Env {
    TEST_SCHEMA: string;
  }
}
