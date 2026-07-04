import { createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

// The renderer runs inside Electron with no URL bar, so the router drives an
// in-memory history (like the marketing site's TanStack Router setup, minus the
// server). Navigation between /login · /onboarding · / is phase-driven from the
// root route (see routes/__root.tsx).
export function createAppRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
