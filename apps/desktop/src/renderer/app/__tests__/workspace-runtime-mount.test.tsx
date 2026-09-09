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
import { InertSocket } from "./inert-socket";

const dialled: string[] = [];
let vaultReads = 0;

class CountingSocket extends InertSocket {
  constructor(url: string) {
    super();
    dialled.push(url);
  }
}

const VaultReader = () => {
  const { data } = useQuery({
    queryFn: async () => {
      vaultReads += 1;
      return await Promise.resolve("vault");
    },
    queryKey: ["vault", "tree"],
  });
  return <p>{data ?? "loading"}</p>;
};

const mountRouter = () => {
  const indexRoute = createRoute({
    component: VaultReader,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const settingsRoute = createRoute({
    component: () => <p>settings</p>,
    getParentRoute: () => rootRoute,
    path: "/settings",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
  });
  render(<RouterProvider router={router} />);
  return router;
};

const settle = async (): Promise<void> => {
  await act(async () => {});
};

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
