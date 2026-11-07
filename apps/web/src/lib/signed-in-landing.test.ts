import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";

import { routeTree } from "../routeTree.gen";

// the real guard over the real client, which settles its base and its fetch as it loads, so what
// a worker lacks and what get-session answers a live cookie are in place first
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

const CONSENT = "/connect/authorize?client_id=claude";

const open = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: false,
    origin: "http://localhost",
    routeTree,
  });
  await router.load();
  return router;
};

// the library is no route of the site's, so the way there is the browser's own document load
const documentLoads = (): string[] => {
  const loads: string[] = [];
  vi.stubGlobal("window", { location: { replace: (href: string) => loads.push(href) } });
  return loads;
};

// the guard answers signed-out on a server render, which is what vitest reads as
const inBrowser = (): void => {
  vi.stubEnv("SSR", false);
};

const page = async (path: string): Promise<string> =>
  renderToString(createElement(RouterProvider, { router: await open(path) }));

const hrefOf = (html: string, label: string): string | undefined =>
  new RegExp(`<a\\b[^>]*href="(?<href>[^"]+)"[^>]*>${label}</a>`, "u").exec(html)?.groups?.href;

const decoded = (href: string | undefined): string =>
  decodeURIComponent((href ?? "").replaceAll("&amp;", "&"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a session with nowhere to come back to", () => {
  it.each(["/app/sign-in", "/app/sign-up", "/app"])("%s lands in the library", async (path) => {
    inBrowser();
    const loads = documentLoads();
    await open(path);
    expect(loads).toStrictEqual([LIBRARY_PAGE_PATH]);
  });

  it.each(["/app/sign-in", "/app/sign-up"])(
    "%s still lands in the library when next leaves this origin",
    async (path) => {
      inBrowser();
      const loads = documentLoads();
      await open(`${path}?next=${encodeURIComponent("//evil.example/steal")}`);
      expect(loads).toStrictEqual([LIBRARY_PAGE_PATH]);
    },
  );
});

describe("a session with a way back", () => {
  it.each(["/app/sign-in", "/app/sign-up"])("%s follows next", async (path) => {
    inBrowser();
    const loads = documentLoads();
    await open(`${path}?next=${encodeURIComponent(CONSENT)}`);
    expect(loads).toStrictEqual([CONSENT]);
  });
});

describe("moving between sign-in and sign-up", () => {
  it("carries the way back from sign-in to sign-up", async () => {
    const html = await page(`/app/sign-in?next=${encodeURIComponent(LIBRARY_PAGE_PATH)}`);
    expect(decoded(hrefOf(html, "Sign up"))).toContain(`next=${LIBRARY_PAGE_PATH}`);
  });

  it("carries the way back from sign-up to sign-in", async () => {
    const html = await page(`/app/sign-up?next=${encodeURIComponent(LIBRARY_PAGE_PATH)}`);
    expect(decoded(hrefOf(html, "Sign in"))).toContain(`next=${LIBRARY_PAGE_PATH}`);
  });

  it("adds nothing to a link when nothing asked to come back", async () => {
    expect(hrefOf(await page("/app/sign-in"), "Sign up")).toBe("/app/sign-up");
    expect(hrefOf(await page("/app/sign-up"), "Sign in")).toBe("/app/sign-in");
  });
});
