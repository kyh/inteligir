import { createFileRoute } from "@tanstack/react-router";

import { LibraryLayout, seedScopes } from "#library/library-layout";
import { librarySearchSchema } from "#library/library-search";
import { RenderCrash } from "#library/render-crash";

import libraryCss from "../library/styles/globals.css?url";

// The library: drawn in the browser alone, over the account's cell, so the Worker serves its
// document as a shell. The tab opens once a document, in its beforeLoad, which no split takes, so
// the open is imported lazily and lands in the library's chunk with every other module only its
// routes reach (src/library/CLAUDE.md § The library is one chunk).
export const Route = createFileRoute("/library")({
  ssr: false,
  headers: () => ({
    // a deploy replaces the page, so its document is asked again every load
    "cache-control": "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    // the site links the page, and its document is an empty shell until someone signed in opens it
    "x-robots-tag": "noindex, nofollow",
  }),
  head: () => ({
    meta: [{ title: "inteligir" }],
    links: [{ rel: "stylesheet", href: libraryCss }],
  }),
  validateSearch: librarySearchSchema,
  beforeLoad: async () => {
    const { openTab } = await import("#library/library-tab");
    return { opening: await openTab() };
  },
  loader: seedScopes,
  // the QueryClient decides what is fresh: a preload never caches a loader's answer of its own
  preloadStaleTime: 0,
  component: LibraryLayout,
  errorComponent: RenderCrash,
  codeSplitGroupings: [["loader", "component", "errorComponent"]],
});
