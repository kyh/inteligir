// The library's page (`@repo/workspace`, built into this Worker's assets under LIBRARY_PAGE_PATH):
// every path under its prefix reaches the Worker first (`assets.runWorkerFirst` in
// cloudflare.config.ts), which answers a file the build holds as it is and every other path with
// the page's one document, so a deep link (the page's Settings, an item open by its query) loads
// the page and its router draws it. Only the hashed files under its `assets/` skip the Worker. No
// other path falls back to the page, so a mistyped site route still answers the site's own 404.
//
// The document's policy is the page's: its own scripts and SQLite's wasm, which the replica
// compiles in the tab (`'wasm-unsafe-eval'`); calls and the socket to this origin alone; nothing
// remote drawn in an item, so a saved page cannot beacon on open; no frame, no worker.

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";

export const isLibraryPagePath = (pathname: string): boolean =>
  pathname === LIBRARY_PAGE_PATH || pathname.startsWith(`${LIBRARY_PAGE_PATH}/`);

// the socket's origin: CSP3 says 'self' covers it, which not every browser the page meets reads so
const socketOrigin = (url: URL): string =>
  `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;

/** @internal */
export const libraryPagePolicy = (url: URL): string =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    // React's style attributes and the editor's runtime <style> are not nonceable
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${socketOrigin(url)}`,
    // a PDF item's viewer is the browser's, over the library's own bytes
    "object-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join("; ");

const documentHeaders = (url: URL) =>
  ({
    // a deploy replaces the page, so its document is asked again every load
    "cache-control": "no-cache",
    "content-security-policy": libraryPagePolicy(url),
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  }) satisfies Record<string, string>;

// what the handler reads of the assets binding
type PageAssets = Pick<Env["ASSETS"], "fetch">;

export const handleLibraryPage = async (
  request: Request,
  assets: PageAssets,
): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { headers: { allow: "GET, HEAD" }, status: 405 });
  }
  const url = new URL(request.url);
  // a file the page's build holds outside its hashed assets, answered as the build wrote it
  if (url.pathname !== LIBRARY_PAGE_PATH && !url.pathname.endsWith("/")) {
    const file = await assets.fetch(request);
    if (file.ok) {
      return file;
    }
    await file.body?.cancel();
  }
  // the asset server answers the directory's index.html at its slash
  const page = await assets.fetch(
    new Request(new URL(`${LIBRARY_PAGE_PATH}/`, url), { method: request.method }),
  );
  if (!page.ok) {
    await page.body?.cancel();
    return new Response("the library's page is not built into this deploy", { status: 503 });
  }
  return new Response(page.body, { headers: documentHeaders(url), status: 200 });
};
