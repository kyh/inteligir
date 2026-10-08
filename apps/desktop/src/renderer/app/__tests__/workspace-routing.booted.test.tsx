import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { routeRendererFetch } from "../actions/__tests__/booted-fetch";
import { chord, sidebarState } from "./boot-workspace";
import { InertSocket } from "./inert-socket";

const bootAt = async (history: RouterHistory) => {
  const booted = await bootTestApp();
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  const router = createRouter({ history, routeTree });
  render(<RouterProvider router={router} />);
  await screen.findByRole("tablist", { name: "Panel tabs" });
  return { booted, router };
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings over the workspace", () => {
  it("covers it inert with its chords stood down, and the way back finds it as it was", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/"] }));
    fireEvent.keyDown(window, chord("k"));
    const composer = await screen.findByLabelText("Ask the agent");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });
    expect(router.state.location.pathname).toBe("/settings");
    expect(composer.closest("[inert]")).not.toBeNull();

    fireEvent.keyDown(window, chord("p"));
    fireEvent.keyDown(document.body, { key: "[" });
    await act(async () => {});
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sidebarState("left")).toBe("expanded");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/");
    expect(composer.isConnected).toBe(true);
    expect(composer.closest("[inert]")).toBeNull();
    expect(composer).toHaveProperty("value", "half a thought");
  });
});
