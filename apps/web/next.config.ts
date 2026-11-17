import type { NextConfig } from "next";

import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

const config: NextConfig = {
  // Else `next dev` writes its own `apps/web/AGENTS.md`; the guidance is the root's.
  agentRules: false,
  cacheComponents: true,
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
