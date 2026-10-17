// one downscaler for the whole server: a cover the fill keeps and a grid thumbnail the thumb route
// serves both go through it, so the process limit on the system's image tool is one queue.

const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

type DownscaledType = (typeof MEDIA_TYPES)[number];

// what passes through untouched where nothing can resize it: a raster, never an SVG, whose
// passthrough is the macOS path's alone (§4.5)
const RASTER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

type RasterType = (typeof RASTER_TYPES)[number];

export type ImageDownscale = (
  bytes: Uint8Array,
  mediaType: string,
  maxEdge: number,
) => Promise<{ bytes: Uint8Array; mediaType: DownscaledType } | null>;

const PASSTHROUGH_MAX_BYTES = 1024 * 1024;

const rasterType = (mediaType: string): RasterType | null =>
  RASTER_TYPES.find((type) => type === mediaType.toLowerCase()) ?? null;

// PIVOT-STUB(S1): replaced by sips on macOS, two at once and 64 queued at most (§4.5)
export const createImageDownscale =
  (_args: { platform: NodeJS.Platform }): ImageDownscale =>
  async (bytes, mediaType) => {
    const type = rasterType(mediaType);
    if (type === null || bytes.byteLength > PASSTHROUGH_MAX_BYTES) {
      return await Promise.resolve(null);
    }
    return await Promise.resolve({ bytes, mediaType: type });
  };
