// one table for the desktop and worker asset routes: a drift is a file that renders on one
// device and 400s on the other. an allowlist with no fallback: the bytes come from a vault a
// hostile git remote can write, served from an origin a credential trusts, so a guessed text/html
// is stored xss. svg can carry script; <img> never runs it but a direct navigation would, which is
// why both routes answer with a sandbox csp. the table says what may be SERVED; `takesBytes` says
// what may be STORED, which is wider (an archive is an item's original, never served).

import { isAnnotationsStorePath } from "@repo/notes/annotations/store-schema";
import { isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";

export type AssetKind = "image" | "pdf" | "video" | "audio";

interface AssetMediaType {
  kind: AssetKind;
  mediaType: string;
}

const row = (kind: AssetKind, mediaType: string): AssetMediaType => ({ kind, mediaType });

export const VAULT_ASSET_MEDIA_TYPES: ReadonlyMap<string, AssetMediaType> = new Map([
  [".apng", row("image", "image/apng")],
  [".avif", row("image", "image/avif")],
  [".bmp", row("image", "image/bmp")],
  [".gif", row("image", "image/gif")],
  [".ico", row("image", "image/x-icon")],
  [".jpeg", row("image", "image/jpeg")],
  [".jpg", row("image", "image/jpeg")],
  [".png", row("image", "image/png")],
  [".svg", row("image", "image/svg+xml")],
  [".webp", row("image", "image/webp")],
  [".pdf", row("pdf", "application/pdf")],
  [".m4v", row("video", "video/x-m4v")],
  [".mov", row("video", "video/quicktime")],
  [".mp4", row("video", "video/mp4")],
  [".webm", row("video", "video/webm")],
  [".aac", row("audio", "audio/aac")],
  [".flac", row("audio", "audio/flac")],
  [".m4a", row("audio", "audio/mp4")],
  [".mp3", row("audio", "audio/mpeg")],
  [".wav", row("audio", "audio/wav")],
]);

const assetRow = (path: string): AssetMediaType | null => {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  return VAULT_ASSET_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null;
};

export const assetMediaType = (path: string): string | null => assetRow(path)?.mediaType ?? null;

export const assetKind = (path: string): AssetKind | null => assetRow(path)?.kind ?? null;

// what may be stored as bytes: not a doc (a doc is text, written as text), not an annotation
// store and not a metadata path (both the app's own)
export const takesBytes = (path: string): boolean =>
  !isDocPath(path) && !isAnnotationsStorePath(path) && !isVaultMetadataPath(path);
