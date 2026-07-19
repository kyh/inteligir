// ---------------------------------------------------------------------------
// Bundled Google OAuth client. The desktop shell bakes credentials into ITS
// bundle via electron-vite `define` and passes them in as
// HostOptions.bundledGoogleClient (build defines can't live in a library
// consumed by multiple bundlers); the INTELIGIR_GOOGLE_OAUTH_CLIENT_* env
// vars are the runtime fallback (desktop dev loads apps/desktop/.env after
// startup; server/cli read the plain environment).
//
// SECURITY NOTE: this is a Google "Desktop app" (installed application) type
// client. Its client secret is NOT a confidential credential by Google's own
// installed-app spec (RFC 8252 §8.5 / Google OAuth docs: "the client secret
// is obviously not treated as a secret" for installed apps) — shipping it
// inside the binary is Google's documented model. Per-user tokens are still
// minted through the normal consent flow; nothing user-scoped is bundled.
// ---------------------------------------------------------------------------

import {
  GOOGLE_OAUTH_CLIENT_SLUG,
  type CreateOAuthClientInput,
  type ExecutorOAuthClient,
} from "@repo/bridge/executor";
import type { EnsureGoogleClientResult } from "@repo/bridge/ipc-registry";

import { resolveGoogleOAuthEndpoints } from "./emulate-connectors";

export type BundledGoogleClient = { clientId: string; clientSecret: string };

function optionOrEnv(optionValue: string | undefined, envName: string): string {
  // Read process.env lazily (call time, not module load) so the desktop
  // shell's dev-only loadEnvFile — which runs after imports — is visible.
  const fromOption = optionValue?.trim() ?? "";
  if (fromOption) return fromOption;
  return process.env[envName]?.trim() ?? "";
}

/** The bundled client, or null when neither the shell (HostOptions) nor the
 * environment carries a complete one — absent/empty values mean the
 * dialog-based "paste your own GCP app" flow. */
export function getBundledGoogleClient(
  shellProvided?: BundledGoogleClient,
): BundledGoogleClient | null {
  const clientId = optionOrEnv(shellProvided?.clientId, "INTELIGIR_GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = optionOrEnv(
    shellProvided?.clientSecret,
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
  // Resolved per call (not baked): real Google by default, the emulate/env
  // override under the Phase 4b dev flag — see emulate-connectors.ts.
  const endpoints = resolveGoogleOAuthEndpoints();
  await ops.createOAuthClient({
    owner: "user",
    slug: GOOGLE_OAUTH_CLIENT_SLUG,
    authorizationUrl: endpoints.authorizationUrl,
    tokenUrl: endpoints.tokenUrl,
    grant: "authorization_code",
    clientId: bundled.clientId,
    clientSecret: bundled.clientSecret,
  });
  return { status: "ready", source: "bundled" };
}
