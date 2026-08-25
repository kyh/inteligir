import { type ArtifactsMintResponse } from "@repo/api/cloud/artifacts/artifacts-schema";
import { z } from "zod";
import { jsonNoStore, refuse } from "./cloud-http";
import { createDb } from "./db/client";
import { verifyDeviceCredential } from "./device/device-auth";

// ---------------------------------------------------------------------------
// `POST /v1/artifacts/mint` (device-authed) — the per-user Artifacts repo and
// a scoped git token for it, so the local app can wire the vault's default
// remote without the user owning any git host.
//
// FEATURE-FLAGGED, honestly: Cloudflare Artifacts is in beta and this account
// is still gated (the API answers error 10004 until access lands). With
// `ARTIFACTS_ENABLED` unset the route answers the typed `artifacts-not-enabled`
// envelope — which the app renders as "bring your own remote for now" — and
// NOTHING here dials Cloudflare. The flag-on half is written against the
// documented REST surface (developers.cloudflare.com/artifacts/api/rest-api/):
//
//   POST   /accounts/:account/artifacts/namespaces/:ns/repos       {name}
//   POST   /accounts/:account/artifacts/namespaces/:ns/tokens      {repo,scope,ttl}
//   DELETE /accounts/:account/artifacts/namespaces/:ns/repos/:name
//
// EVERY Cloudflare v4 response wraps its payload in `{success, errors,
// messages, result}`. Reading `plaintext` off the response ROOT parses a shape
// the API never sends — and because the token is minted before the parse, the
// failure mode is the expensive one: a real token created, then discarded with
// a 500, on every single call. The envelope is unwrapped in one place below,
// and `artifacts-api.test.ts` drives the real shape through a stubbed fetch,
// because a beta-gated account cannot answer for itself.
// ---------------------------------------------------------------------------

const ARTIFACTS_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_NAMESPACE = "default";
/** 30 days — long enough that a routine sync never mid-airs on expiry, short
 * enough that a leaked token dies on its own. The app re-mints before expiry. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Cloudflare's v4 envelope around the token mint, read for the two fields
 * this route needs. `success: false` is a refusal even at HTTP 200 — which is
 * how error 10004 (no beta access) actually arrives, so the literal is what
 * makes an unwrapped error fail the parse. `expires_at` is best-effort: an
 * absent or unreadable one falls back to the requested TTL below rather than
 * discarding a token that really was minted. */
const mintedTokenSchema = z.looseObject({
  success: z.literal(true),
  result: z.looseObject({
    plaintext: z.string(),
    expires_at: z.string().optional().catch(undefined),
  }),
});

/** The account's Artifacts configuration, or null when this deployment does
 * not serve Artifacts at all. One reader, so "enabled" and "configured" cannot
 * drift apart between the mint and the delete. */
type ArtifactsConfig = {
  readonly accountId: string;
  readonly apiToken: string;
  readonly namespace: string;
};

function artifactsConfig(env: Env): ArtifactsConfig | null {
  if (env.ARTIFACTS_ENABLED !== "true") return null;
  if (env.CLOUDFLARE_ACCOUNT_ID === undefined || env.CLOUDFLARE_API_TOKEN === undefined) {
    return null;
  }
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    namespace: env.ARTIFACTS_NAMESPACE ?? DEFAULT_NAMESPACE,
  };
}

/** One repo per user, named from the VERIFIED userId — the same
 * no-caller-supplied-names rule the ThreadSyncDO address follows. */
function repoName(userId: string): string {
  return `vault-${userId.toLowerCase()}`;
}

function namespaceUrl(config: ArtifactsConfig): string {
  return `${ARTIFACTS_API_BASE}/accounts/${config.accountId}/artifacts/namespaces/${config.namespace}`;
}

function authHeaders(config: ArtifactsConfig) {
  return { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" };
}

export async function handleArtifactsMint(request: Request, env: Env): Promise<Response> {
  const verified = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (verified === null) return refuse("unauthorized", "No valid device credential.");

  if (env.ARTIFACTS_ENABLED !== "true") {
    return refuse(
      "artifacts-not-enabled",
      "Artifacts hosting isn't enabled on this deployment yet — configure your own git remote.",
    );
  }
  const config = artifactsConfig(env);
  if (config === null) return refuse("internal", "Artifacts is enabled but not configured.");

  const repo = repoName(verified.userId);
  const base = namespaceUrl(config);

  // Ensure-create: a repo that already exists fails here and succeeds at the
  // token mint below, so the mint is the step that decides — no error-shape
  // parsing of a beta API this account cannot yet observe.
  await fetch(`${base}/repos`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({ name: repo }),
  });

  const minted = await fetch(`${base}/tokens`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({ repo, scope: "write", ttl: TOKEN_TTL_SECONDS }),
  });
  const parsed = mintedTokenSchema.safeParse(await minted.json().catch(() => null));
  if (!minted.ok || !parsed.success) {
    return refuse("internal", `Artifacts token mint failed (${minted.status}).`);
  }
  const result = parsed.data.result;
  const expiresAt = result.expires_at === undefined ? Number.NaN : Date.parse(result.expires_at);

  const response: ArtifactsMintResponse = {
    remote: `https://${config.accountId}.artifacts.cloudflare.net/git/${config.namespace}/${repo}.git`,
    token: result.plaintext,
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + TOKEN_TTL_SECONDS * 1000 : expiresAt,
  };
  return jsonNoStore(response);
}

/**
 * Delete the user's Artifacts repo — the vault bytes this deployment hosts,
 * which `docs/privacy.md` promises go with the account. Deleting the repo
 * revokes every token scoped to it; there is nothing else to collect.
 *
 * Flag-aware: with Artifacts disabled no repo was ever created, so there is
 * genuinely nothing to delete and the step is a no-op rather than a failure.
 * A 404 is success for the same reason. Anything else THROWS, so the
 * surrounding `beforeDelete` aborts and the account survives to ask again —
 * silently keeping a user's notes after they asked for deletion is the one
 * outcome that must not be possible.
 */
export async function deleteArtifactsRepo(env: Env, userId: string): Promise<void> {
  const config = artifactsConfig(env);
  if (config === null) return;

  const response = await fetch(`${namespaceUrl(config)}/repos/${repoName(userId)}`, {
    method: "DELETE",
    headers: authHeaders(config),
  });
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(`artifacts repo delete failed: ${response.status}`);
  }
}
