// The policy every document the site renders carries, the library's among them: its own scripts,
// each inline one by this request's nonce, and no wasm; calls and the socket to this origin alone;
// nothing remote drawn in an item, so a saved page cannot beacon on open; no frame but the library's
// own files, and no worker but the site's own scripts, which an import reads on. A response that
// already names a policy keeps it (a file served under its own sandbox, the consent page), and one
// that is no document carries none.

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { DRAWING_DIRECTIVES } from "@repo/editor/drawing-policy";

const NONCE_BYTES = 16;

export const mintNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCodePoint(...bytes));
};

// the socket's origin: CSP3 says 'self' covers it, which not every browser the page meets reads so
const socketOrigin = (url: URL): string =>
  `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;

export const pagePolicy = (url: URL, nonce: string): string =>
  [
    ...DRAWING_DIRECTIVES,
    `script-src 'self' 'nonce-${nonce}'`,
    // ipc: is the Mac app's command channel; blocked, Tauri falls back to postMessage, and no
    // browser has the scheme
    `connect-src 'self' ${socketOrigin(url)} ipc:`,
    // a PDF item's viewer is the browser's, over the library's own bytes
    "object-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Chromium draws a PDF item's viewer in a frame and checks it here as well as at object-src, so
    // the library's own files on this origin are framed, and nothing else
    `frame-src ${url.origin}${V1_BLOBS_PATH}/`,
    // an import reads its file on a module worker the build ships (src/library/import/import-worker.ts)
    "worker-src 'self'",
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
