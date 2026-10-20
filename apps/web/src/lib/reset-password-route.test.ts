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

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/cloud/device/device-schema";

import { routeTree } from "../routeTree.gen";
import { Route as resetPasswordRoute } from "../routes/app/reset-password";

// The route is ssr: false, so a server render draws none of its views; a route at the same id,
// bound to its search schema and its page, under a router loading as a browser's does, is the
// page a browser draws.
const drawnPage = async (path: string): Promise<string> => {
  const { component, validateSearch } = resetPasswordRoute.options;
  if (component === undefined) {
    throw new Error("the reset-password route draws no page");
  }
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/reset-password",
    validateSearch,
    component,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: false,
    origin: "http://localhost",
    routeTree: rootRoute.addChildren([page]),
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
};

describe("the page the emailed reset link lands on", () => {
  it("serves its shell no-store, with no referrer, since its URL carries a live token", async () => {
    const router = createRouter({
      history: createMemoryHistory({
        initialEntries: ["/app/reset-password?token=live-token-1234"],
      }),
      routeTree,
    });
    await router.load();
    const page = router.state.matches.at(-1);
    expect(page?.routeId).toBe("/app/reset-password");
    expect(page?.headers).toEqual({ "Cache-Control": "no-store" });
    expect(page?.meta).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("opens a live link on the form, bounded as Better Auth is", async () => {
    const html = await drawnPage("/app/reset-password?token=live-token-1234");
    expect(html).toContain("Choose a new password");
    expect(html).toContain('name="confirm"');
    expect(html).toContain(`minLength="${PASSWORD_MIN_LENGTH}"`);
    expect(html).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
  });

  it.each([
    ["a link Better Auth refused", "/app/reset-password?error=INVALID_TOKEN"],
    ["a link with no token", "/app/reset-password"],
    ["a token the query parser read as a number", "/app/reset-password?token=12345678"],
  ])("opens %s on the dead-link view, which sends for a new one", async (_case, path) => {
    const html = await drawnPage(path);
    expect(html).toContain("This link is invalid or has expired");
    expect(html).toContain('href="/app/forgot-password"');
    expect(html).not.toContain('name="confirm"');
  });
});
