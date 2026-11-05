// CLAUDE.md § THE QUERY CLIENT IS THE ROUTER'S. The page's router, made with the one QueryClient
// and the page's library as its context, so a loader seeds what a screen reads through the same
// client the screen reads it from, and wraps every route in both providers.

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";

import { PageLibraryProvider } from "./app/cloud/library-context";
import type { PageLibrary } from "./app/cloud/page-library";
import { RenderCrash } from "./app/render-crash";
import { routeTree } from "./routeTree.gen";

export interface PageContext {
  readonly queryClient: QueryClient;
  readonly library: PageLibrary;
}

// where the page's routes sit: under the Worker's prefix in the browser tab, where the address is
// the page's own; at the root of the Mac's hash history, whose document never changes
export type PageBasepath = typeof LIBRARY_PAGE_PATH | "/";

// the tab's router over the browser's history, the Mac's over the hash, and a suite's over memory
export const createAppRouter = (
  history: RouterHistory,
  context: PageContext,
  basepath: PageBasepath = LIBRARY_PAGE_PATH,
) =>
  createRouter({
    Wrap: ({ children }) => (
      <QueryClientProvider client={context.queryClient}>
        <PageLibraryProvider library={context.library}>{children}</PageLibraryProvider>
      </QueryClientProvider>
    ),
    basepath,
    context,
    // Router-level, not the root route's errorComponent, which would leave every child route
    // unguarded.
    defaultErrorComponent: RenderCrash,
    defaultPreload: "intent",
    // the QueryClient decides what is fresh: a preload never caches a loader's answer of its own
    defaultPreloadStaleTime: 0,
    history,
    routeTree,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
