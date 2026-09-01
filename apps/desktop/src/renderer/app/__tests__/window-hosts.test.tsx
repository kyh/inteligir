// @vitest-environment jsdom
// The window-level hosts answer from EVERY route. `confirm()` parks a promise
// until a mounted <ConfirmDialogHost /> settles it, and `toast()` shows
// nothing until a <Toaster /> paints it — so a host mounted by the workspace
// route alone leaves Settings' Unpair waiting on a dialog that never opens and
// its refusals deferred until the user navigates back to "/". The hosts are
// driven here from a route that is NOT the index, through the real root.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

class InertSocket {
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
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

  it("are mounted by the root route alone", () => {
    // A second host is a second answer to the same call: two confirm dialogs
    // over one store, two toasters painting every toast twice, and a nested
    // TooltipProvider re-waiting the delay the outer one already grouped.
    const HOSTS = ["<ConfirmDialogHost", "<Toaster", "<TooltipProvider"];
    const rendererDir = resolve(import.meta.dirname, "../..");
    const mounts = walk(rendererDir)
      .filter((file) => file.endsWith(".tsx") && !file.includes("__tests__"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return HOSTS.some((host) => source.includes(host));
      })
      .map((file) => relative(rendererDir, file));
    expect(mounts, `the hosts ${HOSTS.join(", ")} belong to routes/__root.tsx alone`).toEqual([
      "routes/__root.tsx",
    ]);
  });
});
