// Every settled outcome is cached, a 404 included: an uncached miss on a repo with no
// release burns GitHub's 60/hour unauthenticated quota, and every SSR then sees 403.

import { z } from "zod";

const GITHUB_REPO = "kyh/inteligir";

const LATEST_RELEASE_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

const SETTLED_TTL_MS = 60 * 60 * 1000;

// only a 404 is an answer about the release; a 403 is GitHub's quota, which the Worker's shared egress can exhaust
const FAILED_TTL_MS = 5 * 60 * 1000;

// the page's SSR waits on this read, so a GitHub that never answers must not hold the landing page
const READ_TIMEOUT_MS = 2000;

// element-wise unknown so one malformed asset cannot hide the real .dmg
const releaseSchema = z.looseObject({ assets: z.array(z.unknown()) });
const releaseAssetSchema = z.looseObject({
  browser_download_url: z.string(),
  name: z.string(),
});

export type DownloadAnswer =
  | { kind: "dmg"; url: string }
  // GitHub answered: there is no release, or the latest one carries no .dmg
  | { kind: "none" }
  // GitHub has given no usable answer since this isolate started
  | { kind: "unknown" };

const NONE: DownloadAnswer = { kind: "none" };
const UNKNOWN: DownloadAnswer = { kind: "unknown" };

// an unanswered lookup still offers the download, one click further on
export const downloadHref = (answer: DownloadAnswer): string | null => {
  switch (answer.kind) {
    case "dmg": {
      return answer.url;
    }
    case "unknown": {
      return LATEST_RELEASE_PAGE;
    }
    case "none": {
      return null;
    }
    // no default
  }
};

const findDmgUrl = (release: z.infer<typeof releaseSchema>): string | null => {
  for (const entry of release.assets) {
    const asset = releaseAssetSchema.safeParse(entry);
    if (asset.success && asset.data.name.endsWith(".dmg")) {
      return asset.data.browser_download_url;
    }
  }
  return null;
};

export interface DownloadUrlDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}

export const createDownloadUrlReader = (
  deps: DownloadUrlDeps = {},
): (() => Promise<DownloadAnswer>) => {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? READ_TIMEOUT_MS;
  const read: NonNullable<DownloadUrlDeps["fetch"]> =
    deps.fetch ?? (async (input, init) => await fetch(input, init));
  let cached: { answer: DownloadAnswer; expires: number } | null = null;

  const settle = (answer: DownloadAnswer): DownloadAnswer => {
    cached = { answer, expires: now() + SETTLED_TTL_MS };
    return answer;
  };

  // stale-if-error: a failed read says nothing about the release, so the last answer stands
  const fail = (cause: string): DownloadAnswer => {
    console.warn({ cause, event: "release-lookup-failed" });
    const answer = cached?.answer ?? UNKNOWN;
    cached = { answer, expires: now() + FAILED_TTL_MS };
    return answer;
  };

  return async function readDownloadUrl() {
    if (cached !== null && cached.expires > now()) {
      return cached.answer;
    }
    try {
      const res = await read(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "inteligir-web" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) {
        return settle(NONE);
      }
      if (!res.ok) {
        return fail(`status ${res.status}`);
      }
      const release = releaseSchema.safeParse(await res.json());
      if (!release.success) {
        return fail("unreadable release");
      }
      const url = findDmgUrl(release.data);
      return settle(url === null ? NONE : { kind: "dmg", url });
    } catch (error) {
      return fail(String(error));
    }
  };
};
