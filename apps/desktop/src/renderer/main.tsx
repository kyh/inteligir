import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installDesktopBridge } from "./app/desktop-bridge";
import { installLightPrints } from "./app/note/export-pdf";
import { RenderCrash } from "./app/render-crash";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

// before the first render: every surface that asks the shell reads the bridge as it mounts
installDesktopBridge();
// before the first paint: a stored "off" must not flash red underlines
applyStoredSpellcheck();
installLightPrints();

const router = createRouter({
  // Router-level, not the root route's errorComponent, which would leave every
  // child route unguarded.
  defaultErrorComponent: RenderCrash,
  defaultPreload: "intent",
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
