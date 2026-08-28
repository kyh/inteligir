// @vitest-environment jsdom
// WHERE the workspace runtime is mounted, and what that buys. The QueryClient's
// fresh-forever default and the single invalidation socket are only worth
// anything if they OUTLIVE a route change: a provider per route made
// "/" -> "/settings" -> "/" a cold vault walk, a `git status` and a second
// socket handshake — the exact cost the bus-driven cache exists to avoid.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { useQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as rootRoute } from "../../routes/__root";

const dialled: string[] = [];
let vaultReads = 0;

/** The socket the provider opens; it never opens, so no subscribe frames go
 *  out — the count of constructions is the whole assertion. */
class CountingSocket {
  constructor(url: string) {
    dialled.push(url);
  }
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

/** Stands in for `vault.tree`: bus-covered, so one fetch is the whole budget
 *  no matter how often it mounts. */
function VaultReader() {
  const { data } = useQuery({
    queryKey: ["vault", "tree"],
    queryFn: () => {
      vaultReads += 1;
      return Promise.resolve("vault");
    },
  });
  return <p>{data ?? "loading"}</p>;
}

function mountRouter() {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: VaultReader,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <p>settings</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const settle = (): Promise<void> => act(async () => {});

beforeEach(() => {
  dialled.length = 0;
  vaultReads = 0;
  vi.stubGlobal("WebSocket", CountingSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the workspace runtime", () => {
  it("survives a route change: one socket, no second vault read", async () => {
    const router = mountRouter();
    await settle();
    expect(vaultReads).toBe(1);
    expect(dialled).toHaveLength(1);

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });
    expect(screen.getByText("settings")).toBeDefined();

    await act(async () => {
      await router.navigate({ to: "/" });
    });
    await settle();
    // Still one of each: the runtime belongs to the window, so nothing about it
    // was torn down and rebuilt on the way there and back.
    expect(vaultReads).toBe(1);
    expect(dialled).toHaveLength(1);
  });

  it("is mounted by the root route alone", () => {
    const routesDir = resolve(import.meta.dirname, "../../routes");
    const mounts = readdirSync(routesDir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => readFileSync(join(routesDir, file), "utf8").includes("<WorkspaceProvider"));
    // A second mount below the router is not a second opinion, it is a second
    // runtime — and the route that holds it disposes it on the way out.
    expect(mounts).toEqual(["__root.tsx"]);
  });
});
