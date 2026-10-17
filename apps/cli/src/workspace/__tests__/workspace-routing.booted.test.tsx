import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "../../server/__tests__/boot-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "@repo/workspace/router";
import { routePageFetch } from "./booted-fetch";
import { chord, layOutCardGrids, sidebarState } from "./boot-workspace";
import { InertSocket } from "@repo/workspace/test-support/inert-socket";
import { ScriptedSocket } from "@repo/workspace/test-support/scripted-socket";

// a card in the library's grid, by its item's path
const card = async (path: string): Promise<HTMLElement> => {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = document.querySelector<HTMLElement>(`[role="gridcell"][data-item-path="${path}"]`);
    expect(found).not.toBeNull();
  });
  if (found === null) {
    throw new Error(`the library draws no card for ${path}`);
  }
  return found;
};

// the item the window shows, by the item view's own mark; null is the library
const shownItem = (): string | null =>
  document.querySelector<HTMLElement>("[data-item-view]")?.dataset.itemPath ?? null;

const bootAt = async (
  history: RouterHistory,
  socket: typeof InertSocket | typeof ScriptedSocket = InertSocket,
) => {
  const booted = await bootTestApp();
  vi.stubGlobal("WebSocket", socket);
  layOutCardGrids();
  routePageFetch(booted);
  await booted.client.vault.write({
    content: "---\nid: 01JALPHA0000000000000000AA\n---\n\n# Alpha\n",
    guard: { kind: "overwrite" },
    path: "alpha.md",
  });
  await booted.client.vault.write({
    content: "# Beta\n",
    guard: { kind: "overwrite" },
    path: "beta.md",
  });
  const router = createAppRouter(history);
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

describe("the library is home, and the url names the open item", () => {
  it("opens the item `?item=` names", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/?item=alpha.md"] }));
    await screen.findByRole("heading", { name: "Alpha" });
    expect(shownItem()).toBe("alpha.md");
    expect(router.state.location.search).toEqual({ item: "alpha.md" });
  });

  it("is the library at `/`, where a card opens its item and the way back mirrors no param", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/"] }));
    await screen.findByRole("heading", { name: "All items" });
    expect(shownItem()).toBeNull();
    expect(router.state.location.search).toEqual({});

    fireEvent.doubleClick(await card("beta.md"));
    await screen.findByRole("heading", { name: "Beta" });
    expect(router.state.location.search).toEqual({ item: "beta.md" });

    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    await screen.findByRole("heading", { name: "All items" });
    expect(router.state.location.search).toEqual({});

    // the library is a step in the one history like any item, so going back to it from the item
    // it opened is that Back step, and Forward returns to the item
    expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await screen.findByRole("heading", { name: "Beta" });
    expect(router.state.location.search).toEqual({ item: "beta.md" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "All items" });
    expect(router.state.location.search).toEqual({});
  });

  it("leaves the open item alone through a history Back; the top bar's Back moves both", async () => {
    const { router } = await bootAt(
      createMemoryHistory({ initialEntries: ["/", "/?item=alpha.md"], initialIndex: 1 }),
    );
    await screen.findByRole("heading", { name: "Alpha" });

    act(() => {
      router.history.back();
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(shownItem()).toBe("alpha.md");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "All items" });
    expect(router.state.location.search).toEqual({});
  });
});

describe("Settings over the workspace", () => {
  it("covers it inert with its chords stood down, and the way back finds it as it was", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/?item=alpha.md"] }));
    await screen.findByRole("heading", { name: "Alpha" });
    fireEvent.keyDown(window, chord("f"));
    await screen.findByPlaceholderText("Find in note");
    fireEvent.keyDown(window, chord("k"));
    const composer = await screen.findByLabelText("Ask the agent");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });
    expect(router.state.location.search).toEqual({ item: "alpha.md" });
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
    expect(router.state.location.search).toEqual({ item: "alpha.md" });
    expect(composer.isConnected).toBe(true);
    expect(composer.closest("[inert]")).toBeNull();
    expect(composer).toHaveProperty("value", "half a thought");
    expect(shownItem()).toBe("alpha.md");
  });

  // a move from outside the window (an agent's `vault rename`, Finder, a pull) is the open item
  // vanishing; its id names where it went, so the window follows it there, Settings still up
  it("follows the open item by its id when it moves out from under it, Settings still up", async () => {
    const { booted, router } = await bootAt(
      createMemoryHistory({ initialEntries: ["/?item=alpha.md"] }),
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
      expect(router.state.location.search).toEqual({ item: "gamma.md" });
    });
    expect(router.state.location.pathname).toBe("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
    await waitFor(() => {
      expect(shownItem()).toBe("gamma.md");
    });
  });

  it("lets an item with no id go when it moves, and the url with it", async () => {
    const { booted, router } = await bootAt(
      createMemoryHistory({ initialEntries: ["/?item=beta.md"] }),
      ScriptedSocket,
    );
    await screen.findByRole("heading", { name: "Beta" });

    await booted.client.vault.rename({ from: "beta.md", to: "delta.md" });
    act(() => {
      ScriptedSocket.deliverToAll({
        changes: ["files-changed"],
        entity: "vault",
        paths: ["beta.md", "delta.md"],
        type: "changed",
      });
    });

    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    await screen.findByRole("heading", { name: "All items" });
  });
});
