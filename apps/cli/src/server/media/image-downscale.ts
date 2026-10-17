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

export type ImageDownscale = (
  bytes: Uint8Array,
  mediaType: string,
  maxEdge: number,
) => Promise<{ bytes: Uint8Array; mediaType: DownscaledType } | null>;

// what passes through as it is when nothing can resize it
const PASSTHROUGH_MAX_BYTES = 1024 * 1024;

const downscaledType = (mediaType: string): DownscaledType | null =>
  MEDIA_TYPES.find((type) => type === mediaType.toLowerCase()) ?? null;

// PIVOT-STUB(S1): replaced by sips on macOS, two at once and 64 queued at most (§4.5)
export const createImageDownscale =
  (_args: { platform: NodeJS.Platform }): ImageDownscale =>
  async (bytes, mediaType) => {
    const type = downscaledType(mediaType);
    if (type === null || bytes.byteLength > PASSTHROUGH_MAX_BYTES) {
      return await Promise.resolve(null);
    }
    return await Promise.resolve({ bytes, mediaType: type });
  };
