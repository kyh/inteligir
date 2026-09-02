// one table for the desktop and worker asset routes: a drift is an image that renders on
// one device and 400s on the other. an allowlist with no fallback: the bytes come from a
// vault a hostile git remote can write, served from an origin a credential trusts, so a
// guessed text/html is stored xss. svg can carry script; <img> never runs it but a direct
// navigation would, which is why both routes answer with a sandbox csp.

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

export function assetMediaType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return VAULT_ASSET_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null;
}
