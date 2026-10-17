// a card's cover at the grid's width: a downscaled copy cached in the data dir, so the grid never
// decodes a full-size image per card and the library holds no second copy of it.

import type { Context } from "hono";
import type { ImageDownscale } from "../media/image-downscale";
import type { VaultService } from "./vault-service";

export interface VaultThumbDeps {
  service: VaultService;
  downscale: ImageDownscale;
  // the thumbnails' cache lives under it
  dataDir: string;
}

// PIVOT-STUB(S2): serves the cached thumbnail, filled by the downscale, and the original when that
// answers null (§12.3 point 4)
export const handleVaultThumb = (c: Context, _deps: VaultThumbDeps): Response =>
  c.text("Not found", 404);
