// The policy every document the site renders carries, the library's among them: its own scripts,
// each inline one by this request's nonce, and no wasm; calls and the socket to this origin alone;
// nothing remote drawn in an item, so a saved page cannot beacon on open; no frame, no worker. A
// response that already names a policy keeps it (a file served under its own sandbox, the consent
// page), and one that is no document carries none.

const NONCE_BYTES = 16;

export const mintNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCodePoint(...bytes));
};

// the socket's origin: CSP3 says 'self' covers it, which not every browser the page meets reads so
const socketOrigin = (url: URL): string =>
  `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;

/** @internal */
export const pagePolicy = (url: URL, nonce: string): string =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // React's style attributes and the editor's runtime <style> are not nonceable
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // ipc: is the Mac app's command channel; blocked, Tauri falls back to postMessage, and no
    // browser has the scheme
    `connect-src 'self' ${socketOrigin(url)} ipc:`,
    // a PDF item's viewer is the browser's, over the library's own bytes
    "object-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join("; ");

const isDocument = (response: Response): boolean =>
  response.headers.get("content-type")?.startsWith("text/html") === true;

export const withPagePolicy = (response: Response, url: URL, nonce: string): Response => {
  if (!isDocument(response) || response.headers.has("content-security-policy")) {
    return response;
  }
  // a fetched response's headers are immutable, so the policy goes on a copy over the same body
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", pagePolicy(url, nonce));
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
