import { z } from "zod";

// ---------------------------------------------------------------------------
// The Artifacts mint: `POST /v1/artifacts/mint` (device-authed) answers the
// git remote of this account's per-user Artifacts repo plus a scoped,
// short-lived access token for it. Feature-flagged server-side while the
// Cloudflare account waits on beta access: flag-off answers the
// `artifacts-not-enabled` error envelope (HTTP 503), which the app renders as
// "bring your own git remote for now" rather than a failure.
// ---------------------------------------------------------------------------

export const artifactsMintResponseSchema = z
  .object({
    /** The repo's git remote URL — what the vault checkout adds as `origin`. */
    remote: z.url(),
    /** Plaintext access token, never stored server-side; embed as the
     * credential for `remote` and re-mint before `expiresAt`. */
    token: z.string().min(1),
    /** Epoch ms. */
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ArtifactsMintResponse = z.infer<typeof artifactsMintResponseSchema>;
