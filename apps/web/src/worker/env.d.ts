// The OPTIONAL runtime vars — declaration-merged into the generated `Env` from
// worker-configuration.d.ts. Values are set with `wrangler secret put` (prod) or
// .dev.vars (local) and are never committed.
//
// The one REQUIRED secret, BETTER_AUTH_SECRET, is not here: wrangler.jsonc's
// `secrets.required` names it, so `wrangler types` emits it onto `Env` itself
// (non-optional) and warns in dev when it's missing. Everything below stays
// hand-declared because it is genuinely optional — listing an optional key in
// `secrets.required` would type it as always-present and turn a missing OAuth
// pair into a dev warning, when absence is the documented default.
//
// There is no `BETTER_AUTH_URL` — the auth baseURL is derived per-request from
// the request origin, so it needs no env at all.

interface Env {
  /** Optional extra trusted origins, comma-separated (e.g. a desktop protocol). */
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  /**
   * Optional extra origins allowed to open a host WebSocket, comma-separated
   * and EXACT (scheme + host + port). The deployed origins are built in; this
   * is how a dev server gets admitted, from `.dev.vars` rather than a commit —
   * so a deployment nobody configured admits nothing extra.
   */
  readonly HOST_ALLOWED_ORIGINS?: string;
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
