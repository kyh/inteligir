import { type ArtifactsMintResponse } from "@repo/cloud-contract/artifacts";
import { refuse, jsonNoStore } from "./cloud-http";
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
//   POST /accounts/:account/artifacts/namespaces/:ns/repos   {name}
//     → { id, name, default_branch, remote, token }
//   POST /accounts/:account/artifacts/namespaces/:ns/tokens  {repo, scope, ttl}
//     → { id, plaintext, scope, expires_at }
//
// It cannot be exercised until beta access lands, and the tests say so: they
// cover the flag-off path and the auth gate, nothing else.
// ---------------------------------------------------------------------------

const ARTIFACTS_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_NAMESPACE = "default";
/** 30 days — long enough that a routine sync never mid-airs on expiry, short
 * enough that a leaked token dies on its own. The app re-mints before expiry. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (accountId === undefined || apiToken === undefined) {
    return refuse("internal", "Artifacts is enabled but not configured.");
  }

  const namespace = env.ARTIFACTS_NAMESPACE ?? DEFAULT_NAMESPACE;
  // One repo per user, named from the VERIFIED credential's userId — the same
  // no-caller-supplied-names rule the ThreadSyncDO address follows.
  const repo = `vault-${verified.userId.toLowerCase()}`;
  const base = `${ARTIFACTS_API_BASE}/accounts/${accountId}/artifacts/namespaces/${namespace}`;
  const authed = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" };

  // Ensure-create: a repo that already exists fails here and succeeds at the
  // token mint below, so the mint is the step that decides — no error-shape
  // parsing of a beta API this account cannot yet observe.
  await fetch(`${base}/repos`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ name: repo }),
  });

  const minted = await fetch(`${base}/tokens`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ repo, scope: "write", ttl: TOKEN_TTL_SECONDS }),
  });
  if (!minted.ok) {
    return refuse("internal", `Artifacts token mint failed (${minted.status}).`);
  }
  const body: unknown = await minted.json();
  if (!isRecord(body) || typeof body.plaintext !== "string") {
    return refuse("internal", "Artifacts token mint answered an unexpected shape.");
  }
  const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;

  const response: ArtifactsMintResponse = {
    remote: `https://${accountId}.artifacts.cloudflare.net/git/${namespace}/${repo}.git`,
    token: body.plaintext,
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + TOKEN_TTL_SECONDS * 1000 : expiresAt,
  };
  return jsonNoStore(response);
}
