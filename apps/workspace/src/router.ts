import { createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { RenderCrash } from "./app/render-crash";
import { routeTree } from "./routeTree.gen";

// the window's router over the browser's history, and a booted suite's over a memory one
export const createAppRouter = (history: RouterHistory) =>
  createRouter({
    // Router-level, not the root route's errorComponent, which would leave every
    // child route unguarded.
    defaultErrorComponent: RenderCrash,
    defaultPreload: "intent",
    history,
    routeTree,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
