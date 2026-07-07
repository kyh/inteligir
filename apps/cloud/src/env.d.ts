// Secrets + optional OAuth vars that live OUTSIDE wrangler.jsonc, so
// `wrangler types` cannot see them (secrets are set with `wrangler secret put`,
// never committed). Declaration-merged into the generated `Env` interface from
// worker-configuration.d.ts. There is no `BETTER_AUTH_URL` — the auth baseURL is
// derived per-request from the request origin, so it needs no env at all.

interface Env {
  /** Dedicated Better Auth signing secret. `wrangler secret put AUTH_SECRET`. */
  readonly AUTH_SECRET: string;
  /** Optional extra trusted origins, comma-separated (e.g. a desktop protocol). */
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  /** Optional GitHub OAuth credentials — the provider is enabled only when both exist. */
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
}
