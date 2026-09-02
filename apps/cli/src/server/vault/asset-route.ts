// not a procedure: an rpc envelope cannot carry an etag, a 304 or its own csp.

import { vaultAssetQuerySchema } from "@repo/api/local/routes";
import { assetMediaType } from "@repo/api/local/vault/vault-schema";
import type { Context } from "hono";
import { vaultRefusalStatus } from "./vault-refusals";
import type { VaultService } from "./vault-service";

// sandbox csp: <img> never runs an svg's script, but a navigation to this url renders it as a
// document. no-cache with an etag: a re-mount revalidates instead of re-downloading.
const ASSET_HEADERS = {
  "cache-control": "no-cache",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

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
    // stat before read: no-cache means every re-mount revalidates.
    const { etag } = await vault.statAsset(query.data.path);
    if (c.req.header("if-none-match") === etag) {
      return c.body(null, 304, { ...ASSET_HEADERS, etag });
    }
    const asset = await vault.readBytes(query.data.path);
    return new Response(asset.bytes, {
      status: 200,
      headers: { ...ASSET_HEADERS, "content-type": mediaType, etag: asset.etag },
    });
  } catch (cause) {
    const status = vaultRefusalStatus(cause);
    if (status === null) {
      throw cause;
    }
    // raw Response: c.text wants a literal StatusCode and this status is a plain number.
    return new Response(cause instanceof Error ? cause.message : "Refused", { status });
  }
}
