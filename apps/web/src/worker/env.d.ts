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

  /**
   * Which agent runtime this deployment runs. "scripted" replaces the
   * Cloudflare Sandbox with the in-memory container (agent/fake-sandbox), which
   * is what the test suite and any deployment without the Workers Paid plan
   * use; anything else (including unset) runs the real one.
   */
  readonly AGENT_RUNTIME?: string;
  /**
   * The public host this Worker is reached on — the container's report URL and
   * the provider OAuth redirect URI are both built from it, and the redirect
   * URI has to match what was registered with the provider byte for byte, so
   * it cannot be derived per-request the way the Better Auth baseURL is.
   */
  readonly PUBLIC_HOST?: string;
  /**
   * Extra hostnames the agent container may reach, comma-separated. The
   * container runs with `enableInternet = false`; the provider APIs and
   * PUBLIC_HOST are allowed by construction, and everything else — a package
   * registry, Cloudflare Browser Run — is a deliberate addition here.
   */
  readonly AGENT_EXTRA_ALLOWED_HOSTS?: string;

  /**
   * Cloudflare Browser Run, for the agent's `browser` tool. Both or neither:
   * the tool is not registered at all without them, because a tool that always
   * fails is worse in a model's menu than a tool that is not there.
   *
   * `AGENT_EXTRA_ALLOWED_HOSTS` must also name `api.cloudflare.com`, and
   * whether the CDP `wss://` upgrade escapes a Sandbox's egress at all is
   * UNVERIFIED — the outbound documentation never names WebSocket upgrade.
   */
  readonly BROWSER_RUN_ACCOUNT_ID?: string;
  readonly BROWSER_RUN_API_TOKEN?: string;

  /**
   * The provider OAuth apps, per provider. All three of a provider's values
   * must be set for it to be offered at all — the same both-or-nothing gate the
   * social sign-in providers use, and for the same reason: an OAuth client
   * belongs to whoever registered it, so a deployment nobody configured must
   * offer nothing rather than a button that dead-ends.
   */
  readonly ANTHROPIC_OAUTH_AUTHORIZE_URL?: string;
  readonly ANTHROPIC_OAUTH_TOKEN_URL?: string;
  readonly ANTHROPIC_OAUTH_CLIENT_ID?: string;
  /** Absent is normal — a public client uses PKCE alone. */
  readonly ANTHROPIC_OAUTH_CLIENT_SECRET?: string;
  readonly OPENAI_OAUTH_AUTHORIZE_URL?: string;
  readonly OPENAI_OAUTH_TOKEN_URL?: string;
  readonly OPENAI_OAUTH_CLIENT_ID?: string;
  readonly OPENAI_OAUTH_CLIENT_SECRET?: string;
}
