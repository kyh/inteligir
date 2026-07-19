// ---------------------------------------------------------------------------
// Emulate-connectors dev override (#461 Phase 4b): route the Google OAuth
// endpoints a Claude session's E2E drive registers in executor at localhost
// (vercel-labs/emulate, `npx emulate --service google` on :4000) instead of
// real Google, so a headless session completes consent with zero human login.
//
// DEV-ONLY and flag-gated, mirroring isFauxAgentEnabled: with no env set the
// resolver returns the baked real-Google URLs — production behavior is
// byte-identical. `INTELIGIR_EMULATE_CONNECTORS=1` is a convenience that sets
// the emulate defaults; the explicit `INTELIGIR_GOOGLE_OAUTH_AUTH_URL` /
// `INTELIGIR_GOOGLE_OAUTH_TOKEN_URL` overrides win over both defaults (an
// emulator on a non-default port, or a single endpoint swapped for debugging).
// The override scopes to WHICH URLs get registered for the "google" OAuth
// client — no TLS/cert behavior changes anywhere (emulate is plain local
// HTTP, so none is needed).
//
// NOTE: an ALREADY-registered "google" client always wins (the
// ensureGoogleOAuthClient contract — the bundled client never overwrites the
// user's own GCP app), so flipping the flag does NOT rewrite an existing
// registration. For an emulate run, start from a state with no "google"
// client (fresh ~/.inteligir/executor/data) — docs/e2e-driving.md covers it.
//
// Env is read lazily (call time, not module load) like optionOrEnv in
// google-oauth-client.ts, so tests can flip it per case and the desktop
// shell's post-import loadEnvFile is visible.
//
// Every env read here — the flag AND the explicit URL overrides — is gated
// on the boot-computed dev-flag bit (server/dev-flags.ts): a PACKAGED build
// refuses the ambient env outright and always resolves real Google.
// ---------------------------------------------------------------------------

import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_TOKEN_URL,
  type CreateOAuthClientInput,
} from "@repo/features/executor";

import { areDevFlagsAllowed } from "../dev-flags";

/** Dev flag gating the emulate defaults. Only honored when boot allowed dev
 * flags (unpackaged builds — dev-flags.ts). */
export function isEmulateConnectorsEnabled(): boolean {
  return areDevFlagsAllowed() && process.env["INTELIGIR_EMULATE_CONNECTORS"] === "1";
}

// emulate's Google service endpoints, verified against emulate v0.9.0's own
// `/.well-known/openid-configuration` (default base port 4000; `emulate start
// -p` moves it — use the explicit env overrides then). The token PATH differs
// from real Google (same-host `/oauth2/token`, not
// `oauth2.googleapis.com/token`) — which is why the resolver swaps FULL URLs,
// never just a host.
export const EMULATE_GOOGLE_AUTHORIZATION_URL = "http://localhost:4000/o/oauth2/v2/auth";
export const EMULATE_GOOGLE_TOKEN_URL = "http://localhost:4000/oauth2/token";

export type GoogleOAuthEndpoints = { authorizationUrl: string; tokenUrl: string };

function envUrl(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * The Google OAuth endpoints every registration site uses. Precedence per
 * URL: explicit env override → emulate default (flag set) → real Google.
 * Packaged builds (dev flags disallowed) always resolve real Google — the
 * explicit URL overrides are a dev/debugging seam, not a production one.
 */
export function resolveGoogleOAuthEndpoints(): GoogleOAuthEndpoints {
  if (!areDevFlagsAllowed()) {
    return { authorizationUrl: GOOGLE_AUTHORIZATION_URL, tokenUrl: GOOGLE_TOKEN_URL };
  }
  const emulate = isEmulateConnectorsEnabled();
  return {
    authorizationUrl:
      envUrl("INTELIGIR_GOOGLE_OAUTH_AUTH_URL") ||
      (emulate ? EMULATE_GOOGLE_AUTHORIZATION_URL : GOOGLE_AUTHORIZATION_URL),
    tokenUrl:
      envUrl("INTELIGIR_GOOGLE_OAUTH_TOKEN_URL") ||
      (emulate ? EMULATE_GOOGLE_TOKEN_URL : GOOGLE_TOKEN_URL),
  };
}

/**
 * Placeholder credentials for emulate runs, so the flow needs no real GCP
 * app: emulate's zero-config Google service accepts ANY client id/secret (no
 * client registration). Null unless the flag is set — the caller composes
 * this as a fallback AFTER the real bundled/env credentials, which still win
 * when present (emulate accepts those too).
 */
export function emulatePlaceholderGoogleClient(): {
  clientId: string;
  clientSecret: string;
} | null {
  if (!isEmulateConnectorsEnabled()) return null;
  return { clientId: "inteligir-emulate", clientSecret: "inteligir-emulate" };
}

/**
 * Rewrite a client-registration input that carries the baked real-Google
 * endpoints (the renderer's manual GCP-app dialog passes the consts verbatim)
 * to the resolved ones, so every registration site picks up the override.
 * Anything else — MCP DCR clients, a custom URL the user typed — passes
 * through untouched. With no env set, resolved === baked, so this is an
 * exact no-op in production.
 */
export function applyGoogleEndpointOverride(input: CreateOAuthClientInput): CreateOAuthClientInput {
  if (input.authorizationUrl !== GOOGLE_AUTHORIZATION_URL || input.tokenUrl !== GOOGLE_TOKEN_URL) {
    return input;
  }
  const resolved = resolveGoogleOAuthEndpoints();
  return { ...input, authorizationUrl: resolved.authorizationUrl, tokenUrl: resolved.tokenUrl };
}
