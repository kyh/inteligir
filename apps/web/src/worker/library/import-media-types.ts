// The media type a file of a markdown library's zip is stored under, by its extension: the
// allowlist the blob route serves each kind's policy by (`./blob-routes.ts`). Anything else is
// stored as bytes of no known type, which the route serves under its sandbox.

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
  [".m4v", "video/x-m4v"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"],
]);

export const importMediaType = (path: string): string | null => {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : (MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null);
};
