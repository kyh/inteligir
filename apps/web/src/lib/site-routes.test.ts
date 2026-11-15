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

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

import type { RequestContext } from "../request-context";
import { routeTree } from "../routeTree.gen";
import { Route as resetPasswordRoute } from "../routes/_site/app/reset-password";
import { siteGraph } from "./structured-data";

// The site's routes as the Worker and a browser load them. isServer: false runs the ssr: false
// routes' pages as a browser would; a server load is handed what the Worker's entry answers a
// page's guard, here whether the request is signed in.
const open = async (path: string, { isServer = false, signedIn = false } = {}) => {
  const serverContext: Pick<RequestContext, "signedIn"> = { signedIn: async () => signedIn };
  const router = createRouter({
    additionalContext: isServer ? { serverContext } : undefined,
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

// where the Worker sends a request in place of the page it asked for
const sentTo = async (path: string, signedIn: boolean): Promise<string | null> => {
  const { _serverResult: answer } = await open(path, { isServer: true, signedIn });
  return answer?.type === "redirect" ? answer.redirect.headers.get("Location") : null;
};

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

const WAY = "/connect/authorize?client_id=c1&state=s1";
const WAY_BACK = encodeURIComponent(WAY);

describe("where a session lands", () => {
  it.each(["/app/sign-in", "/app/sign-up", "/app"])(
    "%s with nowhere to come back to lands in the library",
    async (path) => {
      await expect(sentTo(path, true)).resolves.toBe(LIBRARY_PAGE_PATH);
    },
  );

  it.each(["/app/sign-in", "/app/sign-up"])("%s follows next", async (path) => {
    await expect(sentTo(`${path}?next=${WAY_BACK}`, true)).resolves.toBe(WAY);
  });

  it("goes to the bare sign-in, which lands in the library, when next leaves this origin", async () => {
    const leaving = encodeURIComponent("//evil.example/steal");
    await expect(sentTo(`/app/sign-in?next=${leaving}`, true)).resolves.toBe("/app/sign-in");
  });

  it.each(["/app/sign-in", "/app/sign-up"])(
    "%s is the form for a request that is not signed in",
    async (path) => {
      await expect(sentTo(path, false)).resolves.toBeNull();
    },
  );

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
