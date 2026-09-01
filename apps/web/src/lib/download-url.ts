// The landing page's download CTA: the latest desktop release's `.dmg`, read
// from GitHub through an isolate-local memo. EVERY settled outcome is cached:
// a repo with no release answers 404 on each read, and GitHub's 60/hour
// unauthenticated quota then turns every SSR into a 403 — so a miss must
// count as an answer, not as a reason to ask again.

import { z } from "zod";

const GITHUB_REPO = "kyh/inteligir";

/** How long any settled answer stands — a release lands rarely. */
const SETTLED_TTL_MS = 60 * 60 * 1000;

/** A read that never settled (network, a body that dies mid-parse) retries
 *  sooner: pinning a transient failure for the full hour hides a release
 *  that exists. */
const FAILED_TTL_MS = 5 * 60 * 1000;

/** A GitHub release, read for the only two asset fields this page uses. The
 * list is `unknown` element-wise on purpose: one malformed entry must not hide
 * the real `.dmg` behind a whole-payload refusal. */
const releaseSchema = z.looseObject({ assets: z.array(z.unknown()) });
const releaseAssetSchema = z.looseObject({
  name: z.string(),
  browser_download_url: z.string(),
});

/** The `.dmg` asset's download URL from a parsed GitHub release, or null when
 * the release publishes no `.dmg`. */
function findDmgUrl(release: z.infer<typeof releaseSchema>): string | null {
  for (const entry of release.assets) {
    const asset = releaseAssetSchema.safeParse(entry);
    if (asset.success && asset.data.name.endsWith(".dmg")) return asset.data.browser_download_url;
  }
  return null;
}

export interface DownloadUrlDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
}

/** One reader per isolate: at most one GitHub request per TTL window,
 *  whichever way each read settles. */
export function createDownloadUrlReader(deps: DownloadUrlDeps): () => Promise<string | null> {
  let cached: { url: string | null; expires: number } | null = null;
  return async () => {
    if (cached !== null && cached.expires > deps.now()) return cached.url;
    try {
      const res = await deps.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "inteligir-web" },
      });
      // GitHub's response is untrusted input: PARSE it rather than annotate
      // it. Annotating `await res.json()` with the expected shape is an
      // unchecked assertion — a shape change then surfaces as a TypeError
      // swallowed by the catch below, which reads as "GitHub is down" instead
      // of "we mis-parsed".
      const release = res.ok ? releaseSchema.safeParse(await res.json()) : null;
      const url = release !== null && release.success ? findDmgUrl(release.data) : null;
      cached = { url, expires: deps.now() + SETTLED_TTL_MS };
      return url;
    } catch {
      cached = { url: null, expires: deps.now() + FAILED_TTL_MS };
      return null;
    }
  };
}
