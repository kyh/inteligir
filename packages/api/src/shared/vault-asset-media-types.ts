// The image types a vault asset route will serve, extension → media type —
// ONE table, re-exported by the local and cloud vault schemas, because two
// asset routes (the desktop's /vault/asset and the Worker's /v1/vault/asset)
// serve the same vault and a drift means an image that renders on one device
// and 400s on the other.
//
// It is an ALLOWLIST rather than a lookup with a fallback, and that is the
// whole security design of both routes: the bytes come from a vault a hostile
// git remote can write to, and they are served from an origin a credential
// trusts, so a guessed `text/html` would be stored XSS with the vault as the
// store. An extension outside this table is refused rather than sent as
// `application/octet-stream` — the clients render only images, so a type they
// cannot draw has no reason to leave the store.
//
// SVG is here because notes carry diagrams, and it is the one entry that can
// carry script. `<img>` never runs it; a direct NAVIGATION to the asset URL
// would, which is why both routes answer with a `sandbox` CSP.

export const VAULT_ASSET_MEDIA_TYPES = new Map([
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
]);

/** The allowlist as a lookup: the served media type for `path`'s extension,
 *  or null — never a fallback type. */
export function assetMediaType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return VAULT_ASSET_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null;
}
