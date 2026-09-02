// Every settled outcome is cached, a 404 included: an uncached miss on a repo with no
// release burns GitHub's 60/hour unauthenticated quota, and every SSR then sees 403.

import { z } from "zod";

const GITHUB_REPO = "kyh/inteligir";

const SETTLED_TTL_MS = 60 * 60 * 1000;

// only a 404 is an answer about the release; a 403 is GitHub's quota, which the Worker's shared egress can exhaust
const FAILED_TTL_MS = 5 * 60 * 1000;

// element-wise unknown so one malformed asset cannot hide the real .dmg
const releaseSchema = z.looseObject({ assets: z.array(z.unknown()) });
const releaseAssetSchema = z.looseObject({
  name: z.string(),
  browser_download_url: z.string(),
});

function findDmgUrl(release: z.infer<typeof releaseSchema>): string | null {
  for (const entry of release.assets) {
    const asset = releaseAssetSchema.safeParse(entry);
    if (asset.success && asset.data.name.endsWith(".dmg")) return asset.data.browser_download_url;
  }
  return null;
}

export interface DownloadUrlDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

export function createDownloadUrlReader(deps: DownloadUrlDeps = {}): () => Promise<string | null> {
  const now = deps.now ?? Date.now;
  const read: NonNullable<DownloadUrlDeps["fetch"]> =
    deps.fetch ?? ((input, init) => fetch(input, init));
  let cached: { url: string | null; expires: number } | null = null;
  return async () => {
    if (cached !== null && cached.expires > now()) return cached.url;
    try {
      const res = await read(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "inteligir-web" },
      });
      if (!res.ok) {
        cached = {
          url: null,
          expires: now() + (res.status === 404 ? SETTLED_TTL_MS : FAILED_TTL_MS),
        };
        return null;
      }
      // parse rather than annotate: a shape change would otherwise be a TypeError swallowed by the catch below
      const release = releaseSchema.safeParse(await res.json());
      const url = release.success ? findDmgUrl(release.data) : null;
      cached = { url, expires: now() + SETTLED_TTL_MS };
      return url;
    } catch {
      cached = { url: null, expires: now() + FAILED_TTL_MS };
      return null;
    }
  };
}
