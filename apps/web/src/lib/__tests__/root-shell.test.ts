// A 404 — and a root error — must ship as a full document: without the root
// route's shellComponent those views render with no <html>, no stylesheet and
// no scripts, which is also why they arrive unstyled. Rendered through the
// real root route at a path nothing serves.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { Route as rootRoute } from "../../routes/__root";

describe("the marketing document shell", () => {
  it("renders a path nothing serves inside the <html> shell", async () => {
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/no-such-page"] }),
    });
    await router.load();

    const html = renderToString(createElement(RouterProvider, { router }));
    expect(html).toContain("<html");
    expect(html).toContain("stylesheet");
    expect(html).toContain("404");
  });
});
