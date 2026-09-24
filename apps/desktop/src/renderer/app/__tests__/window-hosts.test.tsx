// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as rootRoute } from "../../routes/__root";
import { client } from "../api";
import { observeRpcStatus } from "../signed-out-state";
import { InertSocket } from "./inert-socket";
import { rendererSources } from "./renderer-sources";

const CONFIRM_TITLE = "Stop syncing this device?";
const DESTRUCTIVE_TITLE = "Delete this note?";
const REFUSAL = "Could not sign this device out.";
const CALL_REFUSED = "Could not reach the server.";

let answered: boolean | null = null;
let settledCalls = 0;

const callServer = async (): Promise<void> => {
  try {
    await client.system.status();
  } catch {
    toast.error(CALL_REFUSED);
  } finally {
    settledCalls += 1;
  }
};

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
        void (async () => {
          answered = await confirm({
            confirmLabel: "Delete",
            destructive: true,
            title: DESTRUCTIVE_TITLE,
          });
        })();
      }}
    >
      Delete note
    </button>
    <button
      type="button"
      onClick={() => {
        toast.error(REFUSAL);
      }}
    >
      Refuse
    </button>
    <button
      type="button"
      onClick={() => {
        void callServer();
      }}
    >
      Call
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
  settledCalls = 0;
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observeRpcStatus(200);
});

// what the server's http gate answers a page whose credential it no longer accepts, and an ordinary answer.
const serverAnswering = (status: 200 | 401) =>
  vi.fn(async () =>
    status === 401
      ? new Response("This request carried no valid inteligir device token", { status })
      : Response.json({ json: {}, meta: [] }, { status }),
  );

// sonner paints a published toast on a later task, so an absent one is only absent after a wait.
const TOAST_PAINT_MS = 100;

describe("the window-level hosts", () => {
  it("open the confirm dialog from a non-index route, and settle its promise", async () => {
    mountAtSettings();
    fireEvent.click(await screen.findByText("Sign out"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(CONFIRM_TITLE);
    const signOut = within(dialog).getByRole("button", { name: "Sign out" });
    await waitFor(() => {
      expect(document.activeElement).toBe(signOut);
    });

    fireEvent.click(signOut);
    await waitFor(() => {
      expect(answered).toBe(true);
    });
  });

  it("focus Cancel, not the action, when the confirm is destructive", async () => {
    mountAtSettings();
    fireEvent.click(await screen.findByText("Delete note"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(DESTRUCTIVE_TITLE);
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => {
      expect(document.activeElement).toBe(cancel);
    });

    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => {
      expect(answered).toBe(false);
    });
  });

  it("paint a toast on a non-index route", async () => {
    mountAtSettings();
    fireEvent.click(await screen.findByText("Refuse"));
    expect(await screen.findByText(REFUSAL)).toBeDefined();
  });

  it("show one signed-out notice in place of a toast per refused call, until the server answers", async () => {
    vi.stubGlobal("fetch", serverAnswering(401));
    // the client logs every refused call in dev
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mountAtSettings();
    const call = await screen.findByText("Call");
    fireEvent.click(call);
    fireEvent.click(call);

    const notice = await screen.findByRole("alertdialog");
    expect(notice.textContent).toContain("inteligir open");
    await waitFor(() => {
      expect(settledCalls).toBe(2);
    });
    await delay(TOAST_PAINT_MS);
    expect(screen.queryByText(CALL_REFUSED)).toBeNull();

    vi.stubGlobal("fetch", serverAnswering(200));
    fireEvent.click(call);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    fireEvent.click(screen.getByText("Refuse"));
    expect(await screen.findByText(REFUSAL)).toBeDefined();
    expect(logged).toHaveBeenCalled();
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
