// The runtime vars — declaration-merged into the generated `Env` from
// worker-configuration.d.ts. Values are set with `wrangler secret put` (prod) or
// .dev.vars (local) and are never committed.
//
// They are hand-declared rather than named in wrangler.jsonc's `secrets` field,
// which would type them for free: that field also FILTERS `.dev.vars` down to
// the names it lists, so declaring one of them silently drops all the others in
// `vite dev`. See the comment where that field would go.
//
// There is no `BETTER_AUTH_URL` — the auth baseURL is derived per-request from
// the request origin, so it needs no env at all.

interface Env {
  /** Better Auth's signing key. The one REQUIRED secret: without it every
   * /api/auth/* request fails. */
  readonly BETTER_AUTH_SECRET: string;
  /** Optional extra trusted origins, comma-separated. */
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
