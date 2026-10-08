import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import type { BootedTestApp } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../routeTree.gen";
import { InertSocket } from "../../__tests__/inert-socket";
import { routeRendererFetch } from "../../actions/__tests__/booted-fetch";

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

const bootAt = async (entry: string, stalled: readonly string[] = []) => {
  const booted = await bootTestApp();
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  if (stalled.length > 0) {
    stall(booted, stalled);
  }
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree,
  });
  render(<RouterProvider router={router} />);
  return router;
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the account step", () => {
  it("offers an account, and a skip lands on the workspace", async () => {
    const router = await bootAt("/welcome");

    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeDefined();
    expect(stepOnScreen()).toBe("account");
    expect(
      screen.getByText(
        "An account carries your conversations with the agent to your other devices and your iPhone.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Invite code")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(stepOnScreen()).toBeNull();
  });

  it("offers the skip while the account has not answered", async () => {
    const router = await bootAt("/welcome", ["cloud/status"]);

    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(stepOnScreen()).toBeNull();
  });
});
