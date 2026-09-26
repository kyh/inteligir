import path from "node:path";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp, fakeAgentAccounts } from "inteligir/server/testing";
import type { BootTestAppOptions } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../routeTree.gen";
import { InertSocket } from "../../__tests__/inert-socket";
import { routeRendererFetch } from "../../actions/__tests__/booted-fetch";

const WELCOME = "Welcome.md";

const stepOnScreen = (): string | null =>
  document.querySelector<HTMLElement>("[data-welcome-step]")?.dataset.welcomeStep ?? null;

const bootAt = async (entry: string, options: BootTestAppOptions = {}) => {
  const booted = await bootTestApp(options);
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  // listed first, so only the boot's preference opens Welcome.md over it
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
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree,
  });
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
  it("skips the agent and the account, and opens the notes on Welcome.md", async () => {
    const router = await bootAt("/welcome", signedOutAgents());

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(stepOnScreen()).toBe("agent");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("heading", { name: "Back up your notes" })).toBeDefined();
    expect(stepOnScreen()).toBe("account");
    expect(router.state.location.search).toMatchObject({ step: "account" });
    expect(
      screen.getByText(
        "An account backs up your notes and brings them to your other Macs and your iPhone.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Invite code")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ note: WELCOME });
    });
    expect(stepOnScreen()).toBeNull();
    expect(await screen.findByRole("heading", { name: "Welcome to inteligir" })).toBeDefined();
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

  it("says what an account still carries for notes another service syncs", async () => {
    const router = await bootAt("/welcome?step=account", {
      vaultPath: path.join("Library", "Mobile Documents", "com~apple~CloudDocs", "Notes"),
    });

    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeDefined();
    expect(
      screen.getByText(
        "iCloud Drive already syncs these notes, and your phone won't show them. An account still carries your conversations with the agent to your other Macs.",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/your notes start syncing/u)).toBeNull();

    // the workspace underneath mirrors the note it booted on into the url, beside the step
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ note: WELCOME, step: "account" });
    });
    expect(stepOnScreen()).toBe("account");
  });
});
