// The renderer's entry: mount the router into the document the build shipped.
//
// ONE module script, and it is what makes the policy a fixed header rather
// than a per-request nonce — a plain Vite build injects nothing at runtime for
// a nonce to admit (`csp.ts` states the whole argument).

import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RenderCrash } from "./app/render-crash";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // Every route match, not just the root's — see render-crash.tsx for why the
  // root route's own `errorComponent` would not cover the workspace.
  defaultErrorComponent: RenderCrash,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
