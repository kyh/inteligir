import { platformShortcutModifier } from "@repo/editor/hotkey-spelling";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { routeRendererFetch } from "../actions/__tests__/booted-fetch";
import { InertSocket } from "./inert-socket";

const chord = (key: string): KeyboardEventInit =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

// the rail opens on its Files view, whose row for the open note is the current page
const highlighted = (): string | null =>
  document.querySelector<HTMLElement>('[role="treeitem"][aria-current="page"]')?.dataset.path ??
  null;

const sidebarState = (side: "left" | "right"): string | null =>
  document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`)?.dataset
    .state ?? null;

const railRow = (path: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  if (row === null) {
    throw new Error(`the rail draws no row for ${path}`);
  }
  return row;
};

const bootAt = async (entry: string) => {
  const booted = await bootTestApp();
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  await booted.client.vault.write({ content: "# Alpha\n", path: "alpha.md" });
  await booted.client.vault.write({ content: "# Beta\n", path: "beta.md" });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree,
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(highlighted()).toBe("alpha.md");
  });
  return router;
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the open note has one owner", () => {
  it("leaves the rail on the open note through a history Back; the top bar's Back moves both", async () => {
    const router = await bootAt("/?note=alpha.md");

    fireEvent.click(railRow("beta.md"));
    await waitFor(() => {
      expect(highlighted()).toBe("beta.md");
    });
    expect(router.state.location.search).toEqual({ note: "beta.md" });

    act(() => {
      router.history.back();
    });
    await act(async () => {});
    expect(highlighted()).toBe("beta.md");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(highlighted()).toBe("alpha.md");
    });
    expect(router.state.location.search).toEqual({ note: "alpha.md" });
  });
});

describe("Settings over the workspace", () => {
  it("covers it inert with its chords stood down, and the way back finds it as it was", async () => {
    const router = await bootAt("/?note=alpha.md");
    fireEvent.keyDown(window, chord("k"));
    const composer = await screen.findByLabelText("Ask the agent");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });
    expect(router.state.location.search).toEqual({ note: "alpha.md" });
    expect(composer.closest("[inert]")).not.toBeNull();

    fireEvent.keyDown(window, chord("p"));
    fireEvent.keyDown(document.body, { key: "[" });
    await act(async () => {});
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sidebarState("left")).toBe("expanded");

    fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    });
    expect(router.state.location.search).toEqual({ note: "alpha.md" });
    expect(composer.isConnected).toBe(true);
    expect(composer.closest("[inert]")).toBeNull();
    expect(composer).toHaveProperty("value", "half a thought");
    expect(highlighted()).toBe("alpha.md");
  });
});
