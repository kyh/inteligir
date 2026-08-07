// ---------------------------------------------------------------------------
// Which deployment this shell wraps.
//
// The window loads ONE origin and is pinned to it (navigation-guard.ts), so
// this value is the whole trust boundary of the shell: everything the user
// sees, and every credential the session holds, lives behind it. It is
// therefore resolved from exactly two places, in order — the `INTELIGIR_APP_URL`
// environment variable, then the origin baked in at build time — and anything
// that does not parse as an http(s) URL is refused rather than coerced.
//
// The env override is what points a local build at `pnpm dev:web`; the baked
// default is what a packaged build ships with. No third source, and no runtime
// setting: a shell whose target origin can be changed from inside the page it
// loaded is a browser with the user's credentials in it.
// ---------------------------------------------------------------------------

/** Where a build with no configuration points. */
const FALLBACK_APP_URL = "https://inteligir.com";

/** The product route inside the deployment. */
const APP_PATH = "/app";

/** Normalize to an origin with no trailing slash, or null when `raw` is not an
 * http(s) URL. `file:` and custom schemes are refused: the guard's same-origin
 * comparison is meaningless for opaque origins, and nothing here should load
 * one. */
export function parseAppOrigin(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

export type AppUrlSources = {
  /** `INTELIGIR_APP_URL` as the process received it. */
  readonly env: string | undefined;
  /** The origin baked in at build time (electron.vite.config.ts `define`). */
  readonly bundled: string | undefined;
};

/** The origin this shell wraps. Falls through env → bundled → the shipped
 * default, taking the first that parses. */
export function resolveAppOrigin(sources: AppUrlSources): string {
  return parseAppOrigin(sources.env) ?? parseAppOrigin(sources.bundled) ?? FALLBACK_APP_URL;
}

/** The URL the window opens on. */
export function workspaceUrl(origin: string): string {
  return `${origin}${APP_PATH}`;
}
