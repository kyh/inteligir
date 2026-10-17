import path from "node:path";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp, fakeAgentAccounts } from "../../server/__tests__/boot-app";
import type { BootedTestApp, BootTestAppOptions } from "../../server/__tests__/boot-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "@repo/workspace/router";
import { InertSocket } from "@repo/workspace/test-support/inert-socket";
import { routePageFetch } from "./booted-fetch";

const WELCOME = "Welcome.md";

const stepOnScreen = (): string | null =>
  document.querySelector<HTMLElement>("[data-welcome-step]")?.dataset.welcomeStep ?? null;

// procedures held unanswered, so a test sees the window before their answer lands
const stall = (booted: BootedTestApp, stalled: readonly string[]): void => {
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const { pathname } = new URL(url, "http://localhost");
    if (stalled.some((procedure) => pathname.endsWith(`/${procedure}`))) {
      return await Promise.withResolvers<Response>().promise;
    }
    return await booted.request(url, { ...init, signal: null });
  });
};

const bootAt = async (
  entry: string,
  options: BootTestAppOptions = {},
  stalled: readonly string[] = [],
) => {
  const booted = await bootTestApp(options);
  vi.stubGlobal("WebSocket", InertSocket);
  routePageFetch(booted);
  if (stalled.length > 0) {
    stall(booted, stalled);
  }
  // a library of two, so the workspace underneath has cards to draw
  await booted.client.vault.write({
    content: "# Agenda\n",
    guard: { kind: "overwrite" },
    path: "Agenda.md",
  });
  await booted.client.vault.write({
    content: "# Welcome to inteligir\n",
    guard: { kind: "overwrite" },
    path: WELCOME,
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }));
  render(<RouterProvider router={router} />);
  return router;
};

const signedOutAgents = (): BootTestAppOptions => ({
  accounts: fakeAgentAccounts({ claude: { state: "signed-out" }, codex: { state: "signed-out" } }),
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the steps after a first run", () => {
  it("skips the agent and the account, and finishes on the library", async () => {
    const router = await bootAt("/welcome", signedOutAgents());

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(stepOnScreen()).toBe("agent");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("heading", { name: "Back up your library" })).toBeDefined();
    expect(stepOnScreen()).toBe("account");
    expect(router.state.location.search).toMatchObject({ step: "account" });
    expect(
      screen.getByText(
        "An account backs up your library and brings it to your other Macs and your iPhone.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Invite code")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(router.state.location.search).toEqual({});
    expect(stepOnScreen()).toBeNull();
    expect(await screen.findByRole("heading", { name: "All items" })).toBeDefined();
    expect(document.querySelector("[data-item-view]")).toBeNull();
  });

  it("an unknown step starts at the agent", async () => {
    await bootAt("/welcome?step=later", signedOutAgents());

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(stepOnScreen()).toBe("agent");
  });

  it("shows an agent already signed in as connected, and Continue moves on", async () => {
    await bootAt("/welcome");

    expect(await screen.findByText("You're signed in to Claude.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByLabelText("Invite code")).toBeDefined();
    expect(stepOnScreen()).toBe("account");
  });

  it("offers the skip while the account has not answered", async () => {
    const router = await bootAt("/welcome?step=account", {}, ["cloud/status"]);

    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(stepOnScreen()).toBeNull();
  });

  it("says what an account still carries for notes another service syncs", async () => {
    const router = await bootAt("/welcome?step=account", {
      vaultPath: path.join("Library", "Mobile Documents", "com~apple~CloudDocs", "Notes"),
    });

    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeDefined();
    expect(
      screen.getByText(
        "iCloud Drive already syncs this library, and your phone won't show it. An account still carries your conversations with the agent to your other Macs.",
      ),
    ).toBeDefined();

    // the workspace underneath is the library, which puts nothing in the url beside the step
    expect(await screen.findByRole("heading", { name: "All items" })).toBeDefined();
    expect(router.state.location.search).toEqual({ step: "account" });
    expect(stepOnScreen()).toBe("account");
  });
});
