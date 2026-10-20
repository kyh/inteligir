// a saved link's cover: the first candidate that is really a picture of at least 200 px, fetched
// through the guard (10 MiB at most), sniffed by its bytes, downscaled to 640 px on its long edge
// and stored by its hash, so two Macs that fill one link write one file.

import { COVERS_DIR } from "@repo/notes/items/item-kind";
import { pixelSize, sniffMedia } from "@repo/notes/items/sniff-media";

import type { ImageDownscale } from "../../media/image-downscale";
import type { ItemCore } from "../item-core";
import type { Reach } from "./address-guard";
import type { GuardedFetch } from "./guarded-fetch";

const COVER_MAX_BYTES = 10 * 1024 * 1024;
const COVER_EDGE = 640;
const COVER_MIN_EDGE = 200;

const EXTENSIONS = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
} as const;

export interface WrittenCover {
  path: string;
  // false when the same bytes were already in the library
  wrote: boolean;
}

// a picture's bytes kept as a cover, or null when it is too small or nothing can keep it
const keep = async (
  bytes: Uint8Array,
  downscale: ImageDownscale,
  core: Pick<ItemCore, "writeContentAddressed">,
): Promise<WrittenCover | null> => {
  const sniffed = sniffMedia(bytes);
  if (sniffed === null || sniffed.kind !== "image") {
    return null;
  }
  const downscaled = await downscale(bytes, sniffed.mediaType, COVER_EDGE);
  if (downscaled === null) {
    return null;
  }
  // the downscale keeps the aspect, so its output's long edge is the original's when that was smaller
  const size = pixelSize(downscaled.bytes, downscaled.mediaType);
  if (size !== null && Math.max(size.width, size.height) < COVER_MIN_EDGE) {
    return null;
  }
  return await core.writeContentAddressed(
    COVERS_DIR,
    EXTENSIONS[downscaled.mediaType],
    downscaled.bytes,
  );
};

export const findCover = async (args: {
  candidates: readonly string[];
  reach: Reach;
  fetcher: GuardedFetch;
  downscale: ImageDownscale;
  core: Pick<ItemCore, "writeContentAddressed">;
  signal: AbortSignal;
}): Promise<WrittenCover | null> => {
  for (const url of new Set(args.candidates)) {
    if (args.signal.aborted) {
      return null;
    }
    const fetched = await args.fetcher.fetch({
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.5",
      maxBytes: COVER_MAX_BYTES,
      overflow: "refuse",
      reach: args.reach,
      signal: args.signal,
      url,
    });
    if (!fetched.ok) {
      continue;
    }
    const kept = await keep(fetched.response.bytes, args.downscale, args.core);
    if (kept !== null) {
      return kept;
    }
  }
  return null;
};
