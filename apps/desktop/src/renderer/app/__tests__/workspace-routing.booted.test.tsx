import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { routeRendererFetch } from "../actions/__tests__/booted-fetch";
import { chord, sidebarState } from "./boot-workspace";
import { InertSocket } from "./inert-socket";
import { ScriptedSocket } from "./scripted-socket";

// the rail opens on its Files view, whose row for the open note is the current page
const highlighted = (): string | null =>
  document.querySelector<HTMLElement>('[role="treeitem"][aria-current="page"]')?.dataset.path ??
  null;

const railRow = (path: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  if (row === null) {
    throw new Error(`the rail draws no row for ${path}`);
  }
  return row;
};

const bootAt = async (
  history: RouterHistory,
  socket: typeof InertSocket | typeof ScriptedSocket = InertSocket,
) => {
  const booted = await bootTestApp();
  vi.stubGlobal("WebSocket", socket);
  routeRendererFetch(booted);
  await booted.client.vault.write({
    content: "# Alpha\n",
    guard: { kind: "overwrite" },
    path: "alpha.md",
  });
  await booted.client.vault.write({
    content: "# Beta\n",
    guard: { kind: "overwrite" },
    path: "beta.md",
  });
  const router = createRouter({ history, routeTree });
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(highlighted()).toBe("alpha.md");
  });
  return { booted, router };
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
    const { router } = await bootAt(
      createMemoryHistory({ initialEntries: ["/", "/?note=alpha.md"], initialIndex: 1 }),
    );

    fireEvent.click(railRow("beta.md"));
    await waitFor(() => {
      expect(highlighted()).toBe("beta.md");
    });
    expect(router.state.location.search).toEqual({ note: "beta.md" });

    act(() => {
      router.history.back();
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(highlighted()).toBe("beta.md");
    expect(screen.getByRole("navigation", { name: "Note location" }).textContent).toBe("beta");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(highlighted()).toBe("alpha.md");
    });
    expect(router.state.location.search).toEqual({ note: "alpha.md" });
  });
});

describe("Settings over the workspace", () => {
  it("covers it inert with its chords stood down, and the way back finds it as it was", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/?note=alpha.md"] }));
    await screen.findByRole("heading", { name: "Alpha" });
    fireEvent.keyDown(window, chord("f"));
    await screen.findByPlaceholderText("Find in note");
    fireEvent.keyDown(window, chord("k"));
    const composer = await screen.findByLabelText("Ask the agent");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });
    expect(router.state.location.search).toEqual({ note: "alpha.md" });
    expect(composer.closest("[inert]")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Find in note")).toBeNull();

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

  // a move from outside the window (an agent's `mv`, Finder, a pull) is the open note vanishing,
  // so the url lets it go; only a rename the window makes carries the note to its new path
  it("stays up when the open note moves out from under it, and the url lets the note go", async () => {
    const { booted, router } = await bootAt(
      createMemoryHistory({ initialEntries: ["/?note=alpha.md"] }),
      ScriptedSocket,
    );
    await screen.findByRole("heading", { name: "Alpha" });
    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });

    await booted.client.vault.rename({ from: "alpha.md", to: "gamma.md" });
    act(() => {
      ScriptedSocket.deliverToAll({
        changes: ["files-changed"],
        entity: "vault",
        paths: ["alpha.md", "gamma.md"],
        type: "changed",
      });
    });

    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(router.state.location.pathname).toBe("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
    await waitFor(() => {
      expect(railRow("gamma.md")).toBeDefined();
    });
    expect(document.querySelector('[role="treeitem"][data-path="alpha.md"]')).toBeNull();
  });
});
