import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";

import { RenderCrash } from "./app/render-crash";
import { routeTree } from "./routeTree.gen";

declare module "@tanstack/react-start" {
  interface Register {
    /** The per-request context `src/node/app.ts` hands to the Start entry's
     *  fetch. Declaring it here is what types `getGlobalStartContext()` below;
     *  the nonce is required, so no document renders without one. */
    server: { requestContext: { nonce: string } };
  }
}

export function getRouter() {
  // The document's CSP nonce, minted per request by the node entry
  // (src/node/app.ts) and handed in as request context. Start puts it on every
  // tag it renders AND on every script it injects mid-stream, then republishes
  // it as <meta property="csp-nonce"> so the client's own injections inherit
  // it. Undefined in the browser, where the router reads that meta instead —
  // and passing `ssr: { nonce: undefined }` there would overwrite what it read.
  const nonce = getGlobalStartContext()?.nonce;
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    // Every route match, not just the root's — see render-crash.tsx for why
    // the root route's own `errorComponent` would not cover the workspace.
    defaultErrorComponent: RenderCrash,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
  });
}
