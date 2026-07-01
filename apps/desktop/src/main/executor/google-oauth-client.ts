// ---------------------------------------------------------------------------
// Bundled Google OAuth client. Credentials are baked into the main bundle at
// build time via electron-vite `define` (INTELIGIR_GOOGLE_OAUTH_CLIENT_ID /
// INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET — release builds run under with-env,
// so apps/desktop/.env supplies them), with a runtime process.env fallback
// for dev (main/index.ts loadEnvFile's the same .env after startup).
//
// SECURITY NOTE: this is a Google "Desktop app" (installed application) type
// client. Its client secret is NOT a confidential credential by Google's own
// installed-app spec (RFC 8252 §8.5 / Google OAuth docs: "the client secret
// is obviously not treated as a secret" for installed apps) — shipping it
// inside the binary is Google's documented model. Per-user tokens are still
// minted through the normal consent flow; nothing user-scoped is bundled.
// ---------------------------------------------------------------------------

import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_OAUTH_CLIENT_SLUG,
  GOOGLE_TOKEN_URL,
  type CreateOAuthClientInput,
  type ExecutorOAuthClient,
} from "@repo/core/executor";
import type { EnsureGoogleClientResult } from "@repo/core/ipc-registry";

// Build-time defines (electron.vite.config.ts). Declared `| undefined` and
// read behind `typeof` guards so the module stays loadable where the defines
// don't exist (vitest runs the raw source).
declare const BUNDLED_GOOGLE_OAUTH_CLIENT_ID: string | undefined;
declare const BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET: string | undefined;

export type BundledGoogleClient = { clientId: string; clientSecret: string };

function definedOrEnv(defineValue: string | undefined, envName: string): string {
  // Read process.env lazily (call time, not module load) so the dev-only
  // loadEnvFile in main/index.ts — which runs after imports — is visible.
  const fromDefine = typeof defineValue === "string" ? defineValue.trim() : "";
  if (fromDefine) return fromDefine;
  return process.env[envName]?.trim() ?? "";
}

/** The bundled client, or null when the build carries no (complete) one —
 * absent/empty vars mean the dialog-based "paste your own GCP app" flow. */
export function getBundledGoogleClient(): BundledGoogleClient | null {
  const clientId = definedOrEnv(
    typeof BUNDLED_GOOGLE_OAUTH_CLIENT_ID === "undefined"
      ? undefined
      : BUNDLED_GOOGLE_OAUTH_CLIENT_ID,
    "INTELIGIR_GOOGLE_OAUTH_CLIENT_ID",
  );
  const clientSecret = definedOrEnv(
    typeof BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET === "undefined"
      ? undefined
      : BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET,
    "INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET",
  );
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The two executor calls ensure needs — injected so tests run against a fake
 * instead of a live daemon connection. */
export type GoogleOAuthClientOps = {
  listOAuthClients(): Promise<ExecutorOAuthClient[]>;
  createOAuthClient(input: CreateOAuthClientInput): Promise<{ client: string }>;
};

/**
 * Make sure the shared "google" OAuth client exists in executor before a
 * Google consent flow starts. An already-registered client (the user's own
 * GCP app, or a bundled one seeded earlier) always wins — the bundled client
 * NEVER overwrites it. With no registered client and no bundled credentials,
 * returns "unavailable" so the renderer falls back to the GCP dialog.
 */
export async function ensureGoogleOAuthClient(
  ops: GoogleOAuthClientOps,
  bundled: BundledGoogleClient | null,
): Promise<EnsureGoogleClientResult> {
  const clients = await ops.listOAuthClients();
  if (clients.some((c) => c.slug === GOOGLE_OAUTH_CLIENT_SLUG)) {
    return { status: "ready", source: "existing" };
  }
  if (!bundled) return { status: "unavailable" };
  await ops.createOAuthClient({
    owner: "user",
    slug: GOOGLE_OAUTH_CLIENT_SLUG,
    authorizationUrl: GOOGLE_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    grant: "authorization_code",
    clientId: bundled.clientId,
    clientSecret: bundled.clientSecret,
  });
  return { status: "ready", source: "bundled" };
}
