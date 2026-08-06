// ---------------------------------------------------------------------------
// The provider OAuth round-trip, owned by the Worker.
//
// pi's own login flow runs on the machine pi runs on: it spins a loopback
// callback server, opens a browser, and writes the credential to a file it
// then reads directly. None of those three exist here — there is no loopback
// the user's browser can reach, no screen the host shares with them, and the
// filesystem pi would write to is deleted every ten minutes. So the flow moves
// out of pi and into this Worker, and what pi gets instead is a base URL and a
// placeholder key.
//
// PKCE, and the `state` is a SIGNED token rather than an opaque nonce
// (./agent-crypto). That is what lets the callback — an unauthenticated GET the
// provider redirects a browser to — be routed to the right user's Durable
// Object without a lookup table: the token NAMES the object, and the object
// verifies the signature and matches the nonce it parked. The Worker addresses,
// the object verifies, exactly as the socket and asset routes do.
//
// The callback answers with a small HTML page rather than a redirect into the
// app. It is the same shape the password-reset page takes, for the same reason:
// there is no single app URL to return to (this Worker serves a marketing site,
// and the workspace may be anywhere), and a page that says what happened is
// better than a redirect that guesses wrong.
// ---------------------------------------------------------------------------

import { mintScopedToken } from "./agent-crypto";
import { providerEntry, providerOAuthApp } from "./provider-catalog";
import type { PendingAuthorization } from "./provider-credentials";

/** How long an authorization may sit unfinished. Long enough to read a consent
 * screen, short enough that an abandoned one is gone before it is forgotten. */
const AUTHORIZATION_TTL_MS = 10 * 60_000;

/** The callback path, spelled once — the redirect URI registered with the
 * provider must match it byte for byte. */
export const OAUTH_CALLBACK_PATH = "/v1/ai/oauth/callback";

export type StartedAuthorization = {
  readonly authorizeUrl: string;
  readonly pending: PendingAuthorization;
};

/**
 * Build the authorize URL for `providerId` and the pending record that
 * completes it.
 *
 * The verifier never leaves the Durable Object, and the challenge is what the
 * provider sees — so an intercepted authorization code is useless to whoever
 * intercepted it.
 */
export async function startAuthorization(
  env: Env,
  userId: string,
  providerId: string,
  origin: string,
): Promise<StartedAuthorization | { readonly error: string }> {
  const entry = providerEntry(providerId);
  if (entry === null) return { error: `There is no provider called ${providerId}.` };
  if (!entry.requiresAuth) return { error: `${entry.label} needs no connection.` };
  const app = providerOAuthApp(env, providerId);
  if (app === null) {
    return { error: `${entry.label} is not configured on this deployment.` };
  }

  const nonce = crypto.randomUUID();
  const verifier = randomVerifier();
  const state = await mintScopedToken(env.BETTER_AUTH_SECRET, {
    scope: "oauth",
    userId,
    ref: nonce,
    expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
  });
  const redirectUri = `${origin}${OAUTH_CALLBACK_PATH}`;

  const authorizeUrl = new URL(app.authorizeUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", app.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", await challengeFor(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (entry.scopes.length > 0) authorizeUrl.searchParams.set("scope", entry.scopes.join(" "));

  return {
    authorizeUrl: authorizeUrl.toString(),
    pending: {
      provider: providerId,
      nonce,
      verifier,
      redirectUri,
      createdAt: Date.now(),
    },
  };
}

/** The page the provider's redirect lands on. Static, no-store, and it says
 * what happened rather than guessing where to send the browser next. */
export function oauthResultPage(message: string, ok: boolean): Response {
  const title = ok ? "Connected" : "Not connected";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100dvh; padding: 2rem; }
  main { max-width: 32rem; text-align: center; }
  h1 { font-size: 1.375rem; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.75; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** A high-entropy PKCE verifier, in the unreserved character set the spec
 * requires. */
function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
