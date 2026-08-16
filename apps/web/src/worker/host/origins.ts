// ---------------------------------------------------------------------------
// The Origin allowlist — browser defence-in-depth on the ticket MINT.
//
// It guards the one request a cross-site page could otherwise cause: a
// cookie-authenticated POST that mints a socket ticket. A browser attaches
// Origin to every POST, so an unrecognized one is a page that is not ours and
// a cookie it made the browser send. Nothing else in the credential is
// suspect, which is why this corroborates the cookie rather than standing on
// its own (see ./client-class).
//
// It is NOT on the socket upgrade. A browser attaches Origin to a WebSocket
// handshake and a native client cannot, so an upgrade gate would be a rule only
// browsers can pass — and the upgrade is not where admission happens any more:
// a socket opened without a ticket does nothing and is reaped at its deadline.
// Turning the gate into a CLASSIFIER, where an absent Origin means "native",
// would be worse than either: it derives a capability grant from a header a
// caller omits for free.
//
// Two properties of the comparison itself:
//
//   • Exact match on the full origin, never a hostname compare.
//     `http://localhost:5174` and `https://localhost:5174` are different
//     origins, as are two ports on one host; comparing hostnames admits every
//     one of them, including a hostile page served off a dev server the user
//     happens to be running.
//   • Nothing is normalized first. A browser emits an origin in canonical form
//     (lowercase scheme and host, default port omitted, no path), so an origin
//     that would need normalizing did not come from one.
// ---------------------------------------------------------------------------

/** Origins the deployed Worker serves the workspace UI from — the same hosts
 * wrangler.jsonc routes to this script, which is what makes them same-origin
 * to the API half. */
const DEPLOYED_ORIGINS = ["https://inteligir.com", "https://www.inteligir.com"] as const;

/** The one env member this module reads. Narrower than `Env` so a test can
 * state the configuration it is testing — passing the ambient env makes
 * "nothing is configured" mean "nothing is in the developer's .dev.vars". */
export type OriginEnv = { readonly HOST_ALLOWED_ORIGINS?: string };

/**
 * The full set of origins a browser may mint a ticket from: the deployed ones
 * plus whatever `HOST_ALLOWED_ORIGINS` names (comma-separated, exact origins).
 *
 * That var is how a dev origin — `http://localhost:5174`, the workspace vite
 * server — gets in, and it is set in `.dev.vars` / a test binding rather than
 * committed. Fail-closed by construction: a deployment nobody configured
 * admits the deployed origins and nothing else.
 */
export function allowedOrigins(env: OriginEnv): ReadonlySet<string> {
  const extra = env.HOST_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return new Set([...DEPLOYED_ORIGINS, ...(extra ?? [])]);
}

/** Whether `origin` (the raw header, `null` when absent) may mint a ticket. */
export function originAllowed(origin: string | null, allowed: ReadonlySet<string>): boolean {
  if (origin === null) return false;
  return allowed.has(origin);
}
