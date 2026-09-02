// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as rootRoute } from "../../routes/__root";
import { InertSocket } from "./inert-socket";
import { rendererSources } from "./renderer-sources";

const CONFIRM_TITLE = "Stop syncing this device?";
const REFUSAL = "Could not unpair this device.";

let answered: boolean | null = null;

function SettingsStandIn() {
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void (async () => {
            answered = await confirm({ title: CONFIRM_TITLE, confirmLabel: "Unpair" });
          })();
        }}
      >
        Unpair
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
}

function mountAtSettings() {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>workspace</p>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsStandIn,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(<RouterProvider router={router} />);
}

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
    fireEvent.click(await screen.findByText("Unpair"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(CONFIRM_TITLE);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unpair" }));
    });
    expect(answered).toBe(true);
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
    const rendererDir = resolve(import.meta.dirname, "../..");
    const mounts = rendererSources(rendererDir)
      .filter((file) => readFileSync(file, "utf8").includes(host))
      .map((file) => relative(rendererDir, file));
    expect(mounts, `a second ${host} is ${second}; routes/__root.tsx alone mounts it`).toEqual([
      "routes/__root.tsx",
    ]);
  });
});
