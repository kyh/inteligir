// a card's cover at the grid's width: a downscaled copy cached in the data dir, so the grid never
// decodes a full-size image per card and the library holds no second copy of it.

import { vaultThumbQuerySchema } from "@repo/contract/local/routes";
import { assetKind, assetMediaType } from "@repo/contract/local/vault/vault-schema";
import { fileKindOf } from "@repo/notes/items/item-kind";
import { extnamePath, parseVaultPath } from "@repo/notes/knowledge/vault-path";
import type { Context } from "hono";
import type { ImageDownscale } from "../media/image-downscale";
import { thumbCacheFor, thumbKey } from "./thumb-cache";
import type { ThumbAnswer } from "./thumb-cache";
import { vaultRefusalStatus } from "./vault-refusals";
import type { VaultService } from "./vault-service";

export interface VaultThumbDeps {
  service: VaultService;
  downscale: ImageDownscale;
  // the thumbnails' cache lives under it
  dataDir: string;
}

// the original in a thumbnail's place, when nothing could resize it: only one small enough that
// a grid of them costs no more than the thumbnails would
const ORIGINAL_FALLBACK_MAX_BYTES = 2 * 1024 * 1024;

// a sandbox, as every library file but a PDF is served: an svg's script never runs, even when
// this url is opened as a document. no-cache with an etag that names the original's version and
// the width, so a re-mount revalidates for a 304.
const THUMB_HEADERS = {
  "cache-control": "no-cache",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

// what the downscale is told the original is: the served table's type, or the one image the
// table leaves out because a browser cannot draw it but the Mac's own tool reads it
const sourceMediaType = (path: string): string | null =>
  assetMediaType(path) ?? (extnamePath(path).toLowerCase() === ".heic" ? "image/heic" : null);

const make = async (
  deps: VaultThumbDeps,
  path: string,
  width: number,
  key: string,
): Promise<ThumbAnswer> => {
  const cache = thumbCacheFor(deps.dataDir);
  // a request that waited on another's make finds what it wrote
  const cached = await cache.read(key);
  if (cached !== null) {
    return { kind: "thumb", thumb: cached };
  }
  const original = await deps.service.readBytes(path);
  const type = sourceMediaType(path);
  const downscaled = type === null ? null : await deps.downscale(original.bytes, type, width);
  if (downscaled !== null) {
    await cache.write(key, downscaled);
    return { kind: "thumb", thumb: downscaled };
  }
  const served = assetMediaType(path);
  if (
    served !== null &&
    assetKind(path) === "image" &&
    original.bytes.byteLength <= ORIGINAL_FALLBACK_MAX_BYTES
  ) {
    return { bytes: original.bytes, kind: "original", mediaType: served };
  }
  return { kind: "none" };
};

const body = (c: Context, bytes: Uint8Array): Uint8Array<ArrayBuffer> | null =>
  c.req.method === "HEAD" ? null : new Uint8Array(bytes);

export const handleVaultThumb = async (c: Context, deps: VaultThumbDeps): Promise<Response> => {
  const query = vaultThumbQuerySchema.safeParse(c.req.query());
  const parsed = query.success ? parseVaultPath(query.data.path) : null;
  if (!query.success || parsed === null || !parsed.ok) {
    return c.text("Bad request", 400);
  }
  if (fileKindOf(parsed.path) !== "image") {
    return c.text(`${parsed.path} is not an image`, 400);
  }
  const width = Number(query.data.w);
  try {
    const original = await deps.service.statAsset(parsed.path);
    const key = thumbKey(original.path, original.size, original.mtimeMs, width);
    const etag = `"${key}"`;
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { headers: { ...THUMB_HEADERS, etag }, status: 304 });
    }
    const cache = thumbCacheFor(deps.dataDir);
    const cached = await cache.read(key);
    const answer: ThumbAnswer =
      cached === null
        ? await cache.shared(key, async () => await make(deps, original.path, width, key))
        : { kind: "thumb", thumb: cached };
    switch (answer.kind) {
      case "thumb": {
        return new Response(body(c, answer.thumb.bytes), {
          headers: { ...THUMB_HEADERS, "content-type": answer.thumb.mediaType, etag },
          status: 200,
        });
      }
      // the original's own etag, never the thumbnail's: a revalidation once the downscale has
      // room again must not keep the full-size image in the thumbnail's place
      case "original": {
        if (c.req.header("if-none-match") === original.etag) {
          return new Response(null, {
            headers: { ...THUMB_HEADERS, etag: original.etag },
            status: 304,
          });
        }
        return new Response(body(c, answer.bytes), {
          headers: { ...THUMB_HEADERS, "content-type": answer.mediaType, etag: original.etag },
          status: 200,
        });
      }
      case "none": {
        return c.text("No thumbnail", 404);
      }
      default: {
        const exhaustive: never = answer;
        return exhaustive;
      }
    }
  } catch (error) {
    const status = vaultRefusalStatus(error);
    if (status === null) {
      throw error;
    }
    return new Response(error instanceof Error ? error.message : "Refused", { status });
  }
};
