import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { createRequire } from "node:module";
import path from "node:path";

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

// The library's address carries an open item, an account page's a reset token and the consent page's
// an assistant's signed request, so no other site sees any; none is a search result.
const PRIVATE_DOCUMENT_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

// micromark's entity decoder parses through a DOM element under the browser condition, which
// Turbopack resolves for a worker's modules as for the page's, so the import's and the export's
// module workers would load with no document; the table it takes everywhere else costs the page
// about 12 kB gzipped. The package exports no subpath, so the alias names its file, relative to
// this directory, since Turbopack takes an alias as a request
const require = createRequire(import.meta.url);
const NAMED_REFERENCES_TABLE = `./${path.relative(
  import.meta.dirname,
  require.resolve("decode-named-character-reference"),
)}`;

// the site's own config, which its suites read without eve's mount
export const siteConfig: NextConfig = {
  // Else `next dev` writes its own `apps/web/AGENTS.md`; the guidance is the root's.
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
  // bare /app is no page: someone who came for the app goes to the library, which sends a
  // signed-out visit on to sign in
  redirects: async () =>
    await Promise.resolve([{ destination: LIBRARY_PAGE_PATH, permanent: false, source: "/app" }]),
  turbopack: {
    resolveAlias: { "decode-named-character-reference": { browser: NAMED_REFERENCES_TABLE } },
    // Vite's `?raw`, which Turbopack has no built-in for: the legal pages import their docs' text,
    // and the built-in agent's prompt its files (@repo/service/agent/agent-prompt)
    rules: { "*": { condition: { query: "?raw" }, type: "text" } },
  },
};

// outermost, as eve's own wrapper: off Vercel it serves the agent (apps/web/agent) under /eve/v1
// from eve's build, on EVE_NEXT_PRODUCTION_PORT, which `next build` writes into its rewrite, so
// build and start name one port
export default withEve(siteConfig);
