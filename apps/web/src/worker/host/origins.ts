// ---------------------------------------------------------------------------
// The Origin gate on the workspace's WebSocket upgrade.
//
// The node transport's rule was written for an Electron page and a paired
// phone: an ABSENT Origin passed, `file://` passed, and anything whose
// HOSTNAME was localhost passed. Every one of those branches is wrong once the
// client is a browser, so this is the inversion:
//
//   • Absent REJECTS. A browser always attaches Origin to a WebSocket
//     handshake, so its absence means a non-browser caller — and admitting
//     that silently is exactly the CSRF hole the check exists to close.
//   • There is no `file://` client left to admit.
//   • localhost is not a hostname comparison but ONE ENTRY in an exact-match
//     allowlist of full origins. `http://localhost:5174` and
//     `https://localhost:5174` are different origins, as are two ports on the
//     same host; comparing hostnames admits every one of them, including a
//     hostile page served off a dev server the user happens to be running.
//
// Nothing is normalized before the comparison. A browser emits an origin in
// canonical form (lowercase scheme and host, default port omitted, no path),
// so an origin that would need normalizing did not come from one.
//
// The refusal is an HTTP 403 BEFORE the Upgrade, never a close code after it:
// a close on a completed handshake tells an attacker their upgrade succeeded
// and only policy turned them away.
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
 * The full set of origins allowed to open a host socket: the deployed ones
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

/** Whether `origin` (the raw header, `null` when absent) may open a socket. */
export function originAllowed(origin: string | null, allowed: ReadonlySet<string>): boolean {
  if (origin === null) return false;
  return allowed.has(origin);
}
