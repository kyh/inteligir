// Secrets + optional OAuth vars that live OUTSIDE wrangler.jsonc, so
// `wrangler types` cannot see them (secrets are set with `wrangler secret put`,
// never committed). Declaration-merged into the generated `Env` interface from
// worker-configuration.d.ts. `BETTER_AUTH_URL` is NOT here — it is a public
// `var` in wrangler.jsonc and therefore already typed by `wrangler types`.

interface Env {
  /** Dedicated Better Auth signing secret. `wrangler secret put BETTER_AUTH_SECRET`. */
  readonly BETTER_AUTH_SECRET: string;
  /** Optional extra trusted origins, comma-separated (e.g. a desktop protocol). */
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  /** Optional GitHub OAuth credentials — the provider is enabled only when both exist. */
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
}
