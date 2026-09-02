// The landing page's download CTA: the latest desktop release's `.dmg`, read
// from GitHub through an isolate-local memo. EVERY settled outcome is cached:
// a repo with no release answers 404 on each read, and GitHub's 60/hour
// unauthenticated quota then turns every SSR into a 403 — so a miss must
// count as an answer, not as a reason to ask again.

import { z } from "zod";

const GITHUB_REPO = "kyh/inteligir";

/** How long any settled answer stands — a release lands rarely. */
const SETTLED_TTL_MS = 60 * 60 * 1000;

/** A read that never settled retries sooner: pinning a transient failure for
 *  the full hour hides a release that exists. That is a rejected fetch, a body
 *  that dies mid-parse, and every status but 200 and 404 — only 404 is an
 *  answer ABOUT the release; a 403 is GitHub's quota, which the Worker's
 *  shared egress can exhaust without this app asking once. */
const FAILED_TTL_MS = 5 * 60 * 1000;

/** A GitHub release, read for the only two asset fields the CTA reads. The
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

/** Test seams over the network and the clock; production runs on the globals. */
export interface DownloadUrlDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

/** One reader per isolate: at most one GitHub request per TTL window,
 *  whichever way each read settles. */
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
      // GitHub's response is untrusted input: PARSE it rather than annotate
      // it. Annotating `await res.json()` with the expected shape is an
      // unchecked assertion — a shape change then surfaces as a TypeError
      // swallowed by the catch below, which reads as "GitHub is down" instead
      // of "we mis-parsed".
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
