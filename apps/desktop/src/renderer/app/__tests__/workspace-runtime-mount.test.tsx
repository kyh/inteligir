// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as rootRoute } from "../../routes/__root";
import { InertSocket } from "./inert-socket";

const dialled: string[] = [];
let queryReads = 0;
let layoutMounts = 0;

class CountingSocket extends InertSocket {
  constructor(url: string) {
    super();
    dialled.push(url);
  }
}

const ThreadsReader = () => {
  const { data } = useQuery({
    queryFn: async () => {
      queryReads += 1;
      return await Promise.resolve("threads");
    },
    queryKey: ["threads", "list"],
  });
  return <p>{data ?? "loading"}</p>;
};

// the shape the app's tree takes, over a layout that only counts: the real workspace needs a
// server, and workspace-routing.booted.test.tsx drives it through the real tree
const CountingLayout = () => {
  useEffect(() => {
    layoutMounts += 1;
  }, []);
  return (
    <>
      <ThreadsReader />
      <Outlet />
    </>
  );
};

const mountRouter = (entry: string) => {
  const layoutRoute = createRoute({
    component: CountingLayout,
    getParentRoute: () => rootRoute,
    id: "_workspace",
  });
  const indexRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/" });
  const settingsRoute = createRoute({
    component: () => <p>settings</p>,
    getParentRoute: () => layoutRoute,
    path: "/settings",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree: rootRoute.addChildren([layoutRoute.addChildren([indexRoute, settingsRoute])]),
  });
  render(<RouterProvider router={router} />);
  return router;
};

const settle = async (): Promise<void> => {
  await act(async () => {});
};

beforeEach(() => {
  dialled.length = 0;
  queryReads = 0;
  layoutMounts = 0;
  vi.stubGlobal("WebSocket", CountingSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the workspace runtime", () => {
  it("survives / → /settings → /: one layout mount, one socket, no second read", async () => {
    const router = mountRouter("/");
    await settle();
    expect(layoutMounts).toBe(1);
    expect(queryReads).toBe(1);
    expect(dialled).toHaveLength(1);

    await act(async () => {
      await router.navigate({ to: "/settings" });
    });
    expect(screen.getByText("settings")).toBeDefined();

    await act(async () => {
      await router.navigate({ to: "/" });
    });
    await settle();
    expect(layoutMounts).toBe(1);
    expect(queryReads).toBe(1);
    expect(dialled).toHaveLength(1);
  });
});
