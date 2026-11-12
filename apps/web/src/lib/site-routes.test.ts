import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import { routeTree } from "../routeTree.gen";
import { Route as resetPasswordRoute } from "../routes/_site/app/reset-password";
import { internalNextPath } from "./next-path";
import { siteGraph } from "./structured-data";

// The site's routes as the Worker and a browser load them. The real guard over the real client,
// which settles its base and its fetch as it loads, so what a worker lacks and what get-session
// answers a live cookie are in place first; under vitest the guard reads as server-rendered,
// which answers signed-out, until a case says it runs in a browser.
vi.hoisted(() => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  vi.stubGlobal("fetch", async () => {
    const at = new Date().toISOString();
    return Response.json({
      session: { createdAt: at, expiresAt: at, id: "s", token: "t", updatedAt: at, userId: "u" },
      user: {
        createdAt: at,
        email: "a@b.c",
        emailVerified: true,
        id: "u",
        name: "A",
        updatedAt: at,
      },
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// isServer: false runs the ssr: false routes' guards and pages as a browser would
const open = async (path: string, { isServer = false } = {}) => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer,
    origin: "http://localhost",
    routeTree,
  });
  await router.load();
  return router;
};

const landed = async (path: string, options?: { isServer?: boolean }) => {
  const router = await open(path, options);
  return router.state;
};

const drawn = async (path: string, options?: { isServer?: boolean }): Promise<string> =>
  renderToString(createElement(RouterProvider, { router: await open(path, options) }));

// The reset page is ssr: false, so the site's tree draws none of its views; a route at its id,
// bound to its search schema and its page, is the page a browser draws.
const RESET_TREE = (() => {
  const { component, validateSearch } = resetPasswordRoute.options;
  const root = createRootRoute();
  const site = createRoute({ getParentRoute: () => root, id: "_site" });
  const page = createRoute({
    component,
    getParentRoute: () => site,
    path: "/app/reset-password",
    validateSearch,
  });
  return root.addChildren([site.addChildren([page])]);
})();

const resetPage = async (path: string): Promise<string> => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: false,
    origin: "http://localhost",
    routeTree: RESET_TREE,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
};

// the library is no route of the site's, so the way there is the browser's own document load
const documentLoads = (): string[] => {
  const loads: string[] = [];
  vi.stubGlobal("window", { location: { replace: (href: string) => loads.push(href) } });
  vi.stubEnv("SSR", false);
  return loads;
};

const WAY = "/connect/authorize?client_id=c1&state=s1";
const WAY_BACK = encodeURIComponent(WAY);

describe("where a session lands", () => {
  it.each(["/app/sign-in", "/app/sign-up", "/app"])(
    "%s with nowhere to come back to lands in the library",
    async (path) => {
      const loads = documentLoads();
      await open(path);
      expect(loads).toStrictEqual([LIBRARY_PAGE_PATH]);
    },
  );

  it.each(["/app/sign-in", "/app/sign-up"])("%s follows next", async (path) => {
    const loads = documentLoads();
    await open(`${path}?next=${WAY_BACK}`);
    expect(loads).toStrictEqual([WAY]);
  });

  it("lands in the library when next leaves this origin", async () => {
    const loads = documentLoads();
    await open(`/app/sign-in?next=${encodeURIComponent("//evil.example/steal")}`);
    expect(loads).toStrictEqual([LIBRARY_PAGE_PATH]);
  });

  it("is the server's own redirect for bare /app on a browser's first request", async () => {
    const { _serverResult: answer } = await open("/app", { isServer: true });
    expect(answer?.type).toBe("redirect");
    expect(answer?.type === "redirect" && answer.redirect.headers.get("Location")).toBe(
      LIBRARY_PAGE_PATH,
    );
  });

  it("sends a signed-out visit to a page that needs one to sign-in, carrying the way back", async () => {
    const asked = "/connect/extension?from=welcome#connect";
    const { location } = await landed(asked);
    expect(location.pathname).toBe("/app/sign-in");
    expect(internalNextPath(location.search.next)).toBe(asked);
  });

  it("drops a next that is not a path rather than failing the sign-in page", async () => {
    const { matches } = await landed("/app/sign-in?next=5");
    const signIn = matches.at(-1);
    expect(signIn?.routeId).toBe("/_site/app/sign-in");
    expect(signIn?.status).toBe("success");
    expect({ ...signIn?.search }).toStrictEqual({ next: undefined });
  });
});

describe("the way back an account page carries", () => {
  it.each([
    ["/app/sign-in", "/app/sign-up"],
    ["/app/sign-up", "/app/sign-in"],
    ["/app/sign-in", "/app/forgot-password"],
    ["/app/forgot-password", "/app/sign-in"],
  ])("%s links %s with it, and bare with none", async (from, to) => {
    await expect(drawn(`${from}?next=${WAY_BACK}`)).resolves.toContain(
      `href="${to}?next=${WAY_BACK}"`,
    );
    await expect(drawn(from)).resolves.toContain(`href="${to}"`);
  });

  it("leads a live reset link's way out back to sign-in, without its token", async () => {
    const html = await resetPage(`/app/reset-password?token=live-token-1234&next=${WAY_BACK}`);
    expect(html).toContain(`href="/app/sign-in?next=${WAY_BACK}"`);
  });

  it("leads both of a dead reset link's ways out onward", async () => {
    const html = await resetPage(`/app/reset-password?error=INVALID_TOKEN&next=${WAY_BACK}`);
    expect(html).toContain(`href="/app/sign-in?next=${WAY_BACK}"`);
    expect(html).toContain(`href="/app/forgot-password?next=${WAY_BACK}"`);
  });

  it.each(["/app/sign-in", "/app/sign-up", "/app/forgot-password"])(
    "holds %s's submit before it hydrates, which the browser would send as a GET with what was typed",
    async (path) => {
      await expect(drawn(path)).resolves.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    },
  );
});

describe("the page the emailed reset link lands on", () => {
  it("serves its shell no-store, with no referrer, since its URL carries a live token", async () => {
    const { matches } = await landed("/app/reset-password?token=live-token-1234", {
      isServer: true,
    });
    const page = matches.at(-1);
    expect(page?.routeId).toBe("/_site/app/reset-password");
    expect(page?.headers).toStrictEqual({ "Cache-Control": "no-store" });
    expect(page?.meta).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("opens a live link on the form, bounded as Better Auth is", async () => {
    const html = await resetPage("/app/reset-password?token=live-token-1234");
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
    const html = await resetPage(path);
    expect(html).toContain("This link is invalid or has expired");
    expect(html).toContain('href="/app/forgot-password"');
    expect(html).not.toContain('name="confirm"');
  });
});

describe("the marketing document shell", () => {
  it("renders a path nothing serves inside the <html> shell", async () => {
    const html = await drawn("/no-such-page", { isServer: true });
    expect(html).toContain("<html");
    expect(html).toContain("stylesheet");
    expect(html).toContain("404");
  });

  it("carries the site's graph as JSON-LD, with no raw `<`", async () => {
    const html = await drawn("/about", { isServer: true });
    const jsonLd = [
      ...html.matchAll(/<script type="application\/ld\+json">(?<json>.*?)<\/script>/gu),
    ].map((match) => match.groups?.json ?? "");
    expect(jsonLd.some((json) => json.includes("<"))).toBe(false);
    expect(jsonLd).toContain(JSON.stringify(siteGraph()));
  });
});
