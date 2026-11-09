import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";

import { routeTree } from "./routeTree.gen";

// the server's nonce, from the request middleware (src/start.ts); in the browser there is no
// request, and the router reads it back from the csp-nonce meta HeadContent writes
export const getRouter = () =>
  createRouter({
    defaultPreload: "intent",
    routeTree,
    ssr: { nonce: getGlobalStartContext()?.nonce },
  });
