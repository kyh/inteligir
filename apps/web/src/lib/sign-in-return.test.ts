import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "../routeTree.gen";
import { internalNextPath, signedInLanding, SIGNED_IN_HOME } from "./next-path";

// under vitest the session guard reads as server-rendered, which answers signed-out, and
// isServer: false runs the ssr: false routes' guards as a browser would
const land = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: false,
    origin: "http://localhost",
    routeTree,
  });
  await router.load();
  return router.state;
};

const LEAVING_THIS_SITE = [
  "https://evil.example/steal",
  "//evil.example/steal",
  "/\\evil.example/steal",
  "/.//evil.example/steal",
];

const drawn = async (path: string): Promise<string> => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: false,
    origin: "http://localhost",
    routeTree,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
};

describe("signing in from a page that needs a session", () => {
  it("sends a signed-out visit to /app/devices to sign-in, carrying the way back", async () => {
    const { location } = await land("/app/devices");
    expect(location.pathname).toBe("/app/sign-in");
    // the router's search is an object of its own making; what the page reads is its entries
    expect({ ...location.search }).toStrictEqual({ next: "/app/devices" });
    expect(internalNextPath(location.search.next)).toBe("/app/devices");
  });

  it("keeps the query and fragment of the page that was asked for", async () => {
    const asked = "/app/devices?highlight=dev_1#row-3";
    const { location } = await land(asked);
    expect(location.pathname).toBe("/app/sign-in");
    expect(internalNextPath(location.search.next)).toBe(asked);
  });

  it("drops a next that is not a path rather than failing the sign-in page", async () => {
    const { matches } = await land("/app/sign-in?next=5");
    const signIn = matches.at(-1);
    expect(signIn?.routeId).toBe("/app/sign-in");
    expect(signIn?.status).toBe("success");
    expect({ ...signIn?.search }).toStrictEqual({ next: undefined });
  });
});

describe("signing up on the way to a page that needs a session", () => {
  // an assistant's consent page, which the Worker answers before this router
  const way = "/connect/authorize?client_id=c1&state=s1";
  const wayBack = encodeURIComponent(way);

  it("carries the way back from sign-in to sign-up, and back again", async () => {
    const signIn = await drawn(`/app/sign-in?next=${wayBack}`);
    expect(signIn).toContain(`href="/app/sign-up?next=${wayBack}"`);
    const signUp = await drawn(`/app/sign-up?next=${wayBack}`);
    expect(signUp).toContain(`href="/app/sign-in?next=${wayBack}"`);
  });

  it("names no way back when none was asked for", async () => {
    await expect(drawn("/app/sign-in")).resolves.toContain('href="/app/sign-up"');
    await expect(drawn("/app/sign-up")).resolves.toContain('href="/app/sign-in"');
  });

  it("lands on the way back, and on the signed-in home for none or for one leaving this site", () => {
    expect(signedInLanding(way)).toBe(way);
    expect(signedInLanding()).toBe(SIGNED_IN_HOME);
    expect(signedInLanding("//evil.example/steal")).toBe(SIGNED_IN_HOME);
  });
});

describe("resetting a password on the way to a page that needs a session", () => {
  const way = "/connect/authorize?client_id=c1&state=s1";
  const wayBack = encodeURIComponent(way);

  it("carries the way back from sign-in to the reset request, and back again", async () => {
    const signIn = await drawn(`/app/sign-in?next=${wayBack}`);
    expect(signIn).toContain(`href="/app/forgot-password?next=${wayBack}"`);
    const forgot = await drawn(`/app/forgot-password?next=${wayBack}`);
    expect(forgot).toContain(`href="/app/sign-in?next=${wayBack}"`);
  });

  it("names no way back when none was asked for", async () => {
    await expect(drawn("/app/sign-in")).resolves.toContain('href="/app/forgot-password"');
    await expect(drawn("/app/forgot-password")).resolves.toContain('href="/app/sign-in"');
  });

  it.each(LEAVING_THIS_SITE)("carries no way back to %s", async (stranger) => {
    const search = `?next=${encodeURIComponent(stranger)}`;
    const signIn = await drawn(`/app/sign-in${search}`);
    expect(signIn).toContain('href="/app/forgot-password"');
    expect(signIn).not.toContain("evil.example");
    const forgot = await drawn(`/app/forgot-password${search}`);
    expect(forgot).toContain('href="/app/sign-in"');
    expect(forgot).not.toContain("evil.example");
  });
});

describe("an account page before it hydrates", () => {
  it.each(["/app/sign-in", "/app/sign-up", "/app/forgot-password"])(
    "holds %s's submit, which the browser would send as a GET with what was typed",
    async (path) => {
      const page = await drawn(path);
      expect(page).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    },
  );
});
