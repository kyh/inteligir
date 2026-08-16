// ---------------------------------------------------------------------------
// Provider credential injection — the reason the container never holds one.
//
// The agent process inside the sandbox is configured with a PLACEHOLDER API
// key. pi refuses to prompt without one, so the value has to exist; it
// authenticates nothing. Every provider request leaves the container through
// the sandbox's outbound interception, which runs HERE, in the Worker, where
// the encrypted refresh token lives. This function strips whatever the
// container sent and puts a freshly minted, short-lived access token in its
// place.
//
// What that buys, precisely: a model with `bash` — and it has one, because
// there is no agent sandbox in the security sense (CLAUDE.md § Decisions) —
// can read every file and environment variable in the container and find no
// credential. It can still SPEND the credential by making provider calls,
// which is what the interceptor is for; it cannot exfiltrate one.
//
// WHAT THIS DOES NOT COVER, stated rather than implied:
//   • interception is HTTP/HTTPS on ports 80 and 443. Traffic on any other
//     port is never routed through this, which is why `enableInternet` is
//     false and the allowlist is the real confinement — the interceptor is a
//     credential seam, not a firewall.
//   • the identity check is the report token the DO minted for this container
//     (./callback-token). A request that does not carry one is refused rather
//     than served with a token, so a process in the container cannot borrow
//     the credential for a request of its own devising without first stealing
//     the report token — which it can, since the token is in its environment.
//     The token is per-boot and short-lived; that is the bound, and it is a
//     bound rather than a wall.
//
// Kept as a pure function over an injected `mint` so the whole decision —
// which host, which header, what a refusal looks like — is unit-testable
// without a container, a plan, or a provider account.
// ---------------------------------------------------------------------------

import { allProviders, type ProviderEntry } from "./provider-catalog";

/** Header the container puts its report bearer on so the interceptor can tell
 * which user's credential to mint. Distinct from `authorization`, which the
 * provider request itself uses and which this module overwrites. */
export const EGRESS_IDENTITY_HEADER = "x-inteligir-sandbox";

/** A minted, short-lived provider credential. */
type MintedCredential = { readonly token: string };

/** Resolve the caller's identity into a live provider credential, or a
 * sentence saying why not. Implemented over the user's Durable Object. */
export type CredentialMinter = (
  identity: string,
  provider: ProviderEntry,
) => Promise<MintedCredential | { readonly error: string }>;

/** The provider whose API lives at `hostname`, or `null`. */
function providerForHost(hostname: string): ProviderEntry | null {
  return allProviders().find((entry) => entry.apiHost === hostname) ?? null;
}

/**
 * Rewrite one outbound container request so it carries a real credential.
 *
 * A request this deployment cannot authorize is answered with a 4xx JSON body
 * rather than passed through unauthenticated: an unauthenticated provider call
 * comes back as a provider auth error, which reads to the model — and then to
 * the user — as "your account is broken" instead of "this deployment has no
 * credential for you".
 */
export async function injectProviderCredential(
  request: Request,
  mint: CredentialMinter,
): Promise<Request | Response> {
  const hostname = new URL(request.url).hostname;
  const provider = providerForHost(hostname);
  if (provider === null) {
    return egressRefusal(
      403,
      `${hostname} is not a provider this deployment routes credentials to`,
    );
  }
  const identity = request.headers.get(EGRESS_IDENTITY_HEADER);
  if (identity === null || identity === "") {
    return egressRefusal(401, "the sandbox request carried no identity header");
  }
  const minted = await mint(identity, provider);
  if ("error" in minted) return egressRefusal(401, minted.error);

  const headers = new Headers(request.headers);
  // Both credential headers are cleared, not just the one this provider uses:
  // the container may set either, and a leftover on the unused header is a
  // value the provider might still prefer.
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete(EGRESS_IDENTITY_HEADER);
  headers.set(provider.auth.header, `${provider.auth.prefix}${minted.token}`);
  for (const [name, value] of Object.entries(provider.extraHeaders)) headers.set(name, value);
  return new Request(request, { headers });
}

/** The one refusal shape, so a blocked egress reads the same in a container
 * log as it does in a `wrangler tail` line. */
function egressRefusal(status: number, reason: string): Response {
  return Response.json({ error: `sandbox egress refused: ${reason}` }, { status });
}
