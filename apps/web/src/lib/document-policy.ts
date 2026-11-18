import { createHash } from "node:crypto";

import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { DRAWING_DIRECTIVES } from "@repo/editor/drawing-policy";

import { noFlashThemeScript } from "../library/no-flash-theme";

const NONCE_BYTES = 16;

export const mintNonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  return btoa(String.fromCodePoint(...bytes));
};

const DEV_EVAL = process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : [];

const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256").update(noFlashThemeScript).digest("base64")}'`;

const IPC = "ipc:";

const BLOB_UPLOADS = "https://vercel.com/api/blob/";

const FIXED_TAIL = ["base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"];

export const libraryPolicy = (url: URL, nonce: string) =>
  [
    ...DRAWING_DIRECTIVES,
    ["script-src 'self'", `'nonce-${nonce}'`, THEME_SCRIPT_HASH, ...DEV_EVAL].join(" "),
    `connect-src 'self' ${BLOB_UPLOADS} ${IPC}`,
    "object-src 'self'",
    ...FIXED_TAIL,
    `frame-src ${url.origin}${V1_BLOBS_PATH}/`,
    "worker-src 'self'",
  ].join("; ");

export const SITE_POLICY = [
  ...DRAWING_DIRECTIVES,
  ["script-src 'self' 'unsafe-inline'", ...DEV_EVAL].join(" "),
  `connect-src 'self' ${BLOB_UPLOADS} ${IPC}`,
  "object-src 'none'",
  ...FIXED_TAIL,
  "frame-src 'self'",
  "worker-src 'self'",
].join("; ");
