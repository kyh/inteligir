import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { HeroOrb } from "@/components/hero-orb";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";

const GITHUB_REPO = "kyh/inteligir";
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Geometry shared by both arms of the download CTA; each arm adds its own
 *  palette. Themed tokens rather than literal hex — dark is the default theme,
 *  so a hardcoded near-black pill paints itself onto the background. */
const CTA_PILL =
  "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium shadow-lg";

function MacLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" aria-hidden>
      <path d="M849.124134 704.896288c-1.040702 3.157923-17.300015 59.872622-57.250912 118.190843-34.577516 50.305733-70.331835 101.018741-126.801964 101.909018-55.532781 0.976234-73.303516-33.134655-136.707568-33.134655-63.323211 0-83.23061 32.244378-135.712915 34.110889-54.254671 2.220574-96.003518-54.951543-130.712017-105.011682-70.934562-102.549607-125.552507-290.600541-52.30118-416.625816 36.040844-63.055105 100.821243-103.135962 171.364903-104.230899 53.160757-1.004887 103.739712 36.012192 136.028093 36.012192 33.171494 0 94.357018-44.791136 158.90615-38.089503 27.02654 1.151219 102.622262 11.298324 151.328567 81.891102-3.832282 2.607384-90.452081 53.724599-89.487104 157.76107C739.079832 663.275355 847.952448 704.467523 849.124134 704.896288M633.69669 230.749408c29.107945-35.506678 48.235584-84.314291 43.202964-132.785236-41.560558 1.630127-92.196819 27.600615-122.291231 62.896492-26.609031 30.794353-50.062186 80.362282-43.521213 128.270409C557.264926 291.935955 604.745311 264.949324 633.69669 230.749408" />
    </svg>
  );
}

// Isolate-local memo: one GitHub API hit per worker isolate per hour. A null
// url means no downloadable release exists — the page renders "coming soon"
// until the first desktop release is published.
let cached: { url: string | null; expires: number } | null = null;

/** A GitHub release, read for the only two asset fields this page uses. The
 * list is `unknown` element-wise on purpose: one malformed entry must not hide
 * the real `.dmg` behind a whole-payload refusal. */
const releaseSchema = z.looseObject({ assets: z.array(z.unknown()) });
const releaseAssetSchema = z.looseObject({
  name: z.string(),
  browser_download_url: z.string(),
});

type Release = z.infer<typeof releaseSchema>;

/** The `.dmg` asset's download URL from a parsed GitHub release, or null when
 * the release publishes no `.dmg`. */
function findDmgUrl(release: Release): string | null {
  for (const entry of release.assets) {
    const asset = releaseAssetSchema.safeParse(entry);
    if (asset.success && asset.data.name.endsWith(".dmg")) return asset.data.browser_download_url;
  }
  return null;
}

const getDownloadUrl = createServerFn().handler(async (): Promise<string | null> => {
  if (cached && cached.expires > Date.now()) return cached.url;

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "inteligir-web" },
    });
    if (!res.ok) return null;

    // GitHub's response is untrusted input: PARSE it rather than annotate it.
    // Annotating `await res.json()` with the expected shape is an unchecked
    // assertion — a shape change then surfaces as a TypeError swallowed by the
    // outer catch, which reads as "GitHub is down" instead of "we mis-parsed".
    const release = releaseSchema.safeParse(await res.json());
    const url = release.success ? findDmgUrl(release.data) : null;
    cached = { url, expires: Date.now() + CACHE_TTL_MS };
    return url;
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/")({
  loader: () => getDownloadUrl(),
  component: Page,
});

function Page() {
  const downloadUrl = Route.useLoaderData();

  return (
    // The theme provider lives on the page, not in the document shell — see
    // __root.tsx.
    <ThemeProvider>
      <SiteHeader />
      <main className="flex min-h-dvh w-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="h-48 w-48">
            {/* three.js canvas — client-only (no SSR in the worker) */}
            <ClientOnly fallback={null}>
              <HeroOrb />
            </ClientOnly>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 px-6 pb-16">
          {downloadUrl === null ? (
            <span className={`${CTA_PILL} bg-muted text-muted-foreground`}>
              <MacLogoIcon className="size-5 shrink-0" />
              Coming soon for Mac
            </span>
          ) : (
            <a
              href={downloadUrl}
              className={`${CTA_PILL} bg-primary text-primary-foreground transition-opacity duration-200 ease hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
            >
              <MacLogoIcon className="size-5 shrink-0" />
              Download for Mac
            </a>
          )}
          <span className="text-xs text-foreground/60">Requires an OpenAI or Claude account</span>
        </div>
      </main>
    </ThemeProvider>
  );
}
