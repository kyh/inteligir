import { createRouter } from "@tanstack/react-router";

import { RenderCrash } from "./app/render-crash";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    // Every route match, not just the root's — see render-crash.tsx for why
    // the root route's own `errorComponent` would not cover the workspace.
    defaultErrorComponent: RenderCrash,
  });
}
