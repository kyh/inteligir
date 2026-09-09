// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as rootRoute } from "../../routes/__root";
import { InertSocket } from "./inert-socket";
import { rendererSources } from "./renderer-sources";

const CONFIRM_TITLE = "Stop syncing this device?";
const REFUSAL = "Could not sign this device out.";

let answered: boolean | null = null;

const SettingsStandIn = () => (
  <div>
    <button
      type="button"
      onClick={() => {
        void (async () => {
          answered = await confirm({ confirmLabel: "Sign out", title: CONFIRM_TITLE });
        })();
      }}
    >
      Sign out
    </button>
    <button
      type="button"
      onClick={() => {
        toast.error(REFUSAL);
      }}
    >
      Refuse
    </button>
  </div>
);

const mountAtSettings = () => {
  const indexRoute = createRoute({
    component: () => <p>workspace</p>,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const settingsRoute = createRoute({
    component: SettingsStandIn,
    getParentRoute: () => rootRoute,
    path: "/settings",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
  });
  render(<RouterProvider router={router} />);
};

beforeEach(() => {
  answered = null;
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the window-level hosts", () => {
  it("open the confirm dialog from a non-index route, and settle its promise", async () => {
    mountAtSettings();
    fireEvent.click(await screen.findByText("Sign out"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(CONFIRM_TITLE);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(answered).toBe(true);
    });
  });

  it("paint a toast on a non-index route", async () => {
    mountAtSettings();
    fireEvent.click(await screen.findByText("Refuse"));
    expect(await screen.findByText(REFUSAL)).toBeDefined();
  });

  const ROOT_ALONE = [
    ["<ConfirmDialogHost", "two confirm dialogs over one store"],
    ["<Toaster", "two toasters painting every toast twice"],
    ["<TooltipProvider", "a nested provider re-waiting the delay the outer one already grouped"],
    [
      "<WorkspaceProvider",
      "a second runtime — its own socket and cold cache — disposed by whichever route holds it",
    ],
  ] as const;

  it.each(ROOT_ALONE)("%s is mounted by the root route alone", (host, second) => {
    const rendererDir = path.resolve(import.meta.dirname, "../..");
    const mounts = rendererSources(rendererDir)
      .filter((file) => readFileSync(file, "utf-8").includes(host))
      .map((file) => path.relative(rendererDir, file));
    expect(mounts, `a second ${host} is ${second}; routes/__root.tsx alone mounts it`).toEqual([
      "routes/__root.tsx",
    ]);
  });
});
