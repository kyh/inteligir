import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { internalNextPath, SIGNED_IN_HOME } from "../next-path";

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

describe("signing in from a page that needs a session", () => {
  it("sends a signed-out visit to /app/devices to sign-in, carrying the way back", async () => {
    const { location } = await land("/app/devices");
    expect(location.pathname).toBe("/app/sign-in");
    expect(location.search).toEqual({ next: "/app/devices" });
    expect(internalNextPath(location.search.next)).toBe("/app/devices");
  });

  it("keeps the query and fragment of the page that was asked for", async () => {
    const asked = "/app/devices?highlight=dev_1#row-3";
    const { location } = await land(asked);
    expect(location.pathname).toBe("/app/sign-in");
    expect(internalNextPath(location.search.next)).toBe(asked);
  });

  it("sends bare /app to the signed-in home, which asks for a session the same way", async () => {
    const { location } = await land("/app");
    expect(location.pathname).toBe("/app/sign-in");
    expect(location.search).toEqual({ next: SIGNED_IN_HOME });
  });

  it("drops a next that is not a path rather than failing the sign-in page", async () => {
    const { matches } = await land("/app/sign-in?next=5");
    const signIn = matches.at(-1);
    expect(signIn?.routeId).toBe("/app/sign-in");
    expect(signIn?.status).toBe("success");
    expect(signIn?.search).toEqual({});
  });
});
