import { useCommentSurface } from "@repo/editor/comments/comment-store";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bootThreadHarness } from "inteligir/server/testing";
import type { ThreadHarness } from "inteligir/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { routeRendererFetch } from "../actions/__tests__/booted-fetch";
import { readPanelOpen } from "../prefs";
import { InertSocket } from "./inert-socket";

const chord = (key: string): KeyboardEventInit =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

const sidebarState = (side: "left" | "right"): string | null =>
  document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`)?.dataset
    .state ?? null;

const selectedTab = (): string | null =>
  screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent ?? null;

// the socket is inert, so whatever the server should already hold is seeded before the mount
const bootWorkspace = async (seed?: (harness: ThreadHarness) => Promise<void>): Promise<void> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  await seed?.(harness);
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree,
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("tablist", { name: "Panel tabs" });
  expect(sidebarState("right")).toBe("collapsed");
};

const paletteRows = () => within(screen.getByRole("listbox"));

const pickThreadFromPalette = async (title: string): Promise<void> => {
  fireEvent.keyDown(window, chord("p"));
  fireEvent.click(await paletteRows().findByText("Actions"));
  fireEvent.click(await paletteRows().findByText(title));
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an entry that shows something in the closed panel", () => {
  it("opens it on the thread a composer launch started", async () => {
    await bootWorkspace();

    fireEvent.keyDown(window, chord("k"));
    fireEvent.change(await screen.findByLabelText("Ask the agent"), {
      target: { value: "Tidy the intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sidebarState("right")).toBe("expanded");
    });
    expect(selectedTab()).toBe("Actions");
    expect(screen.getByRole("button", { name: "Back to actions" })).toBeDefined();
    expect(readPanelOpen()).toBe(true);
  });

  it("opens it on the thread a palette pick names, and a switch drops the half-typed reply", async () => {
    await bootWorkspace(async (harness) => {
      await harness.client.threads.create({ title: "First action" });
      await harness.client.threads.create({ title: "Second action" });
    });

    await pickThreadFromPalette("First action");
    await waitFor(() => {
      expect(sidebarState("right")).toBe("expanded");
    });
    expect(selectedTab()).toBe("Actions");
    const reply = await screen.findByLabelText("Reply to the agent");
    fireEvent.change(reply, { target: { value: "half a thought" } });

    await pickThreadFromPalette("Second action");
    await waitFor(() => {
      expect(screen.getByLabelText("Reply to the agent")).toHaveProperty("value", "");
    });
  });

  it("leaves zen for a comment click, onto the Comments tab", async () => {
    await bootWorkspace();
    fireEvent.keyDown(window, chord("\\"));
    await waitFor(() => {
      expect(sidebarState("left")).toBe("collapsed");
    });

    act(() => {
      useCommentSurface.getState().actions?.open(["c1"]);
    });

    await waitFor(() => {
      expect(sidebarState("right")).toBe("expanded");
    });
    expect(sidebarState("left")).toBe("expanded");
    expect(selectedTab()).toBe("Comments");
    expect(readPanelOpen()).toBe(true);
  });
});
