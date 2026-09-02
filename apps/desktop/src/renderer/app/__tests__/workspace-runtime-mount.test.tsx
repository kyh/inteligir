// @vitest-environment jsdom

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

class CountingSocket {
  constructor(url: string) {
    dialled.push(url);
  }
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

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
    expect(vaultReads).toBe(1);
    expect(dialled).toHaveLength(1);
  });
});
