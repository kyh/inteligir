// A vault image's raw BYTES. Not a procedure, and it cannot become one: the
// body is bytes with an ETag, a 304 on `if-none-match` and a CSP of its own,
// none of which survives an RPC envelope — and a conditional request that
// answers nothing is exactly what makes a re-mounted image cost a round trip
// instead of a re-download.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { vaultAssetQuerySchema } from "@repo/api/local/routes";
import type { Context } from "hono";
import { assetMediaType } from "./vault-router";
import { VaultServiceError, type VaultService } from "./vault-service";

// An asset is bytes from a vault a git remote can write into, served from the
// app's own origin. `nosniff` pins the declared type, and the sandbox CSP is
// what makes SVG safe: `<img>` never runs its script, but a NAVIGATION to this
// URL renders it as a document, and a sandbox with no `allow-scripts` refuses
// that. `no-cache` with an ETag: a re-mounted image revalidates in a round
// trip instead of re-downloading, and an edited asset is never stale.
const ASSET_HEADERS = {
  "cache-control": "no-cache",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

/** The status a vault refusal answers here. This route is outside the typed
 *  contract, so it states them itself — the same three the contract's `read`
 *  declares, since it reaches the same service. */
function refusalStatus(cause: unknown): 400 | 404 | 413 | null {
  if (cause instanceof VaultPathError) return 400;
  if (!(cause instanceof VaultServiceError)) return null;
  switch (cause.code) {
    case "not_found":
      return 404;
    case "too_large":
      return 413;
    case "conflict":
      return null;
  }
}

export async function handleVaultAsset(c: Context, vault: VaultService): Promise<Response> {
  const query = vaultAssetQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!query.success) {
    return c.text("Bad request", 400);
  }
  const mediaType = assetMediaType(query.data.path);
  if (mediaType === null) {
    return c.text(`${query.data.path} is not an image type this vault serves`, 400);
  }
  try {
    const asset = await vault.readBytes(query.data.path);
    if (c.req.header("if-none-match") === asset.etag) {
      return c.body(null, 304, { ...ASSET_HEADERS, etag: asset.etag });
    }
    return c.body(asset.bytes, 200, {
      ...ASSET_HEADERS,
      "content-type": mediaType,
      etag: asset.etag,
    });
  } catch (cause) {
    const status = refusalStatus(cause);
    if (status === null) {
      throw cause;
    }
    // Text, not the contract's envelope: nothing typed reads this body, and a
    // refusal a browser will render is a sentence.
    return c.text(cause instanceof Error ? cause.message : "Refused", status);
  }
}
