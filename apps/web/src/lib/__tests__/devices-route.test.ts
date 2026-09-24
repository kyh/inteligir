import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { Route as devicesRoute } from "../../routes/app/devices";

// The devices route is client-only, so a server render never runs its guard or its loader; a
// route whose loader throws, bound to the devices route's own error view, is the failed load.
describe("the devices page's failed load", () => {
  it("shows what failed and offers a retry, rather than the root's generic line", async () => {
    const rootRoute = createRootRoute();
    const failing = createRoute({
      getParentRoute: () => rootRoute,
      path: "/app/devices",
      loader: () => {
        throw new Error("Too many requests.");
      },
      errorComponent: devicesRoute.options.errorComponent,
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/app/devices"] }),
      routeTree: rootRoute.addChildren([failing]),
    });
    await router.load();

    const html = renderToString(createElement(RouterProvider, { router }));
    expect(html).toContain("Devices");
    expect(html).toContain("Too many requests.");
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*>.*Try again.*<\/button>/su);
  });
});
