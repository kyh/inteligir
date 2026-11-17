import type { NextConfig } from "next";

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import { SITE_POLICY } from "./src/lib/document-policy";

// Every page's, but a library file's, which sets each of its own: a config header replaces a
// route's header of the same name, so the site's policy would replace a file's sandbox. A document
// rendered per request gets proxy.ts's nonce policy in place of this one.
const SITE_HEADERS = [
  { key: "Content-Security-Policy", value: SITE_POLICY },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

// The library's address carries an open item, and an account page's a reset token, so no other site
// sees either; the site links both, and neither is a search result.
const PRIVATE_DOCUMENT_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const config: NextConfig = {
  // Else `next dev` writes its own `apps/web/AGENTS.md`; the guidance is the root's.
  agentRules: false,
  cacheComponents: true,
  headers: async () =>
    await Promise.resolve([
      { headers: SITE_HEADERS, source: "/((?!v1/blobs/).*)" },
      { headers: PRIVATE_DOCUMENT_HEADERS, source: `${LIBRARY_PAGE_PATH}/:path*` },
      { headers: PRIVATE_DOCUMENT_HEADERS, source: "/app/:path*" },
    ]),
  partialPrefetching: true,
  reactCompiler: true,
  // bare /app is no page: someone who came for the app goes to the library, which sends a
  // signed-out visit on to sign in
  redirects: async () =>
    await Promise.resolve([{ destination: LIBRARY_PAGE_PATH, permanent: false, source: "/app" }]),
  turbopack: {
    // Vite's `?raw`, which Turbopack has no built-in for: the legal pages import their docs' text
    rules: { "*": { condition: { query: "?raw" }, type: "text" } },
  },
};

export default config;
