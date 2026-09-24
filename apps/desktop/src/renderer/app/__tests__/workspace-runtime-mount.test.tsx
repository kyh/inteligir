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
import { Route as workspaceRoute } from "../../routes/_workspace";
import { InertSocket } from "./inert-socket";

const dialled: string[] = [];
let vaultReads = 0;
let layoutMounts = 0;

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

// the shape the app's tree takes, over a layout that only counts: the real workspace needs a
// server, and workspace-routing.booted.test.tsx drives it through the real tree
const CountingLayout = () => {
  useEffect(() => {
    layoutMounts += 1;
  }, []);
  return (
    <>
      <VaultReader />
      <Outlet />
    </>
  );
};

const mountRouter = (entry: string) => {
  const layoutRoute = createRoute({
    component: CountingLayout,
    getParentRoute: () => rootRoute,
    id: "_workspace",
    validateSearch: workspaceRoute.options.validateSearch,
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
  vaultReads = 0;
  layoutMounts = 0;
  vi.stubGlobal("WebSocket", CountingSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the workspace runtime", () => {
  it("survives / → /settings → /: one layout mount, one socket, no second vault read, the note kept", async () => {
    const router = mountRouter("/?note=Notes%2FA.md");
    await settle();
    expect(layoutMounts).toBe(1);
    expect(vaultReads).toBe(1);
    expect(dialled).toHaveLength(1);

    await act(async () => {
      await router.navigate({ search: true, to: "/settings" });
    });
    expect(screen.getByText("settings")).toBeDefined();
    expect(router.state.location.search).toEqual({ note: "Notes/A.md" });

    await act(async () => {
      await router.navigate({ search: true, to: "/" });
    });
    await settle();
    expect(router.state.location.search).toEqual({ note: "Notes/A.md" });
    expect(layoutMounts).toBe(1);
    expect(vaultReads).toBe(1);
    expect(dialled).toHaveLength(1);
  });
});
