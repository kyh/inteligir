import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { createRequire } from "node:module";
import path from "node:path";

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import { SITE_POLICY } from "./src/lib/document-policy";

const SITE_HEADERS = [
  { key: "Content-Security-Policy", value: SITE_POLICY },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const PRIVATE_DOCUMENT_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const require = createRequire(import.meta.url);

const NAMED_REFERENCES_TABLE = `./${path.relative(
  import.meta.dirname,
  require.resolve("decode-named-character-reference"),
)}`;

export const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
  headers: async () =>
    await Promise.resolve([
      { headers: SITE_HEADERS, source: "/((?!v1/blobs/).*)" },
      { headers: PRIVATE_DOCUMENT_HEADERS, source: `${LIBRARY_PAGE_PATH}/:path*` },
      { headers: PRIVATE_DOCUMENT_HEADERS, source: "/app/:path*" },
      { headers: PRIVATE_DOCUMENT_HEADERS, source: "/connect/:path*" },
    ]),
  partialPrefetching: true,
  reactCompiler: true,
  redirects: async () =>
    await Promise.resolve([{ destination: LIBRARY_PAGE_PATH, permanent: false, source: "/app" }]),
  turbopack: {
    resolveAlias: { "decode-named-character-reference": { browser: NAMED_REFERENCES_TABLE } },
    rules: { "*": { condition: { query: "?raw" }, type: "text" } },
  },
};

export default withEve(nextConfig);
