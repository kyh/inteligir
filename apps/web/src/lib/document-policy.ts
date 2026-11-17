// The two policies a document carries. Both draw only this origin's files and bytes the page holds,
// so a saved page cannot beacon on open; call this origin and the Mac app's command channel alone;
// and are framed by nobody. The library and the account pages render per request, so proxy.ts
// hands each a nonce and nothing else inline runs. A marketing page is prerendered, and a page
// built once cannot carry a per-request nonce, so its inline scripts run.

import { createHash } from "node:crypto";

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { DRAWING_DIRECTIVES } from "@repo/editor/drawing-policy";

import { noFlashThemeScript } from "../library/no-flash-theme";

const NONCE_BYTES = 16;

export const mintNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCodePoint(...bytes));
};

// React rebuilds a server error's stack with eval in development, and never in a build
const DEV_EVAL = process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : [];

// the root layout's no-flash script is written by hand, so Next puts no nonce on it
const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256").update(noFlashThemeScript).digest("base64")}'`;

// ipc: is the Mac app's command channel; blocked, Tauri falls back to postMessage, and no browser
// has the scheme
const IPC = "ipc:";

// the socket's origin: CSP3 says 'self' covers it, which not every browser the page meets reads so
const socketOrigin = (url: URL): string =>
  `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;

const FIXED_TAIL = ["base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"];

export const libraryPolicy = (url: URL, nonce: string): string =>
  [
    ...DRAWING_DIRECTIVES,
    ["script-src 'self'", `'nonce-${nonce}'`, THEME_SCRIPT_HASH, ...DEV_EVAL].join(" "),
    `connect-src 'self' ${socketOrigin(url)} ${IPC}`,
    // a PDF item's viewer is the browser's, over the library's own bytes
    "object-src 'self'",
    ...FIXED_TAIL,
    // Chromium draws a PDF item's viewer in a frame and checks it here as well as at object-src, so
    // the library's own files on this origin are framed, and nothing else
    `frame-src ${url.origin}${V1_BLOBS_PATH}/`,
    // an import reads its file on a module worker the build ships (src/library/import/import-worker.ts)
    "worker-src 'self'",
  ].join("; ");

export const SITE_POLICY = [
  ...DRAWING_DIRECTIVES,
  ["script-src 'self' 'unsafe-inline'", ...DEV_EVAL].join(" "),
  `connect-src 'self' ${IPC}`,
  "object-src 'none'",
  ...FIXED_TAIL,
  "frame-src 'self'",
  "worker-src 'self'",
].join("; ");
