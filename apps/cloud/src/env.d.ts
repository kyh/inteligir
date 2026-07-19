// Secrets + optional OAuth vars that live OUTSIDE wrangler.jsonc, so
// `wrangler types` cannot see them (secrets are set with `wrangler secret put`,
// never committed). Declaration-merged into the generated `Env` interface from
// worker-configuration.d.ts. There is no `BETTER_AUTH_URL` — the auth baseURL is
// derived per-request from the request origin, so it needs no env at all.

interface Env {
  /** Dedicated Better Auth signing secret. `wrangler secret put BETTER_AUTH_SECRET`. */
  readonly BETTER_AUTH_SECRET: string;
  /** Optional extra trusted origins, comma-separated (e.g. a desktop protocol). */
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  /** Optional GitHub OAuth credentials — the provider is enabled only when both exist. */
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  /** Optional Google OAuth credentials — same both-or-nothing gate as GitHub. */
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  /**
   * Password-reset sender address (must belong to a domain the owner onboarded
   * with `wrangler email sending enable`). Optional var — defaults to
   * no-reply@inteligir.app; set it to match a differently-named verified domain.
   */
  readonly RESET_FROM_ADDRESS?: string;
  /**
   * Set to "true" ONLY in tests to disable auth rate limiting: the in-process
   * test Worker serves every request from one IP, so a suite that signs up
   * several users would otherwise trip the limiter. Unset in dev/prod → enabled.
   */
  readonly RATE_LIMIT_DISABLED?: string;
}
