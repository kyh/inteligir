import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { bootThreadHarness } from "../../server/__tests__/boot-app";
import type { ThreadHarness } from "../../server/__tests__/boot-app";
import { vi } from "vitest";

import { createAppRouter } from "@repo/workspace/router";
import { routePageFetch } from "./booted-fetch";
import { InertSocket } from "@repo/workspace/test-support/inert-socket";

export const chord = (key: string): KeyboardEventInit =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

export const sidebarState = (side: "left" | "right"): string | null =>
  document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`)?.dataset
    .state ?? null;

export interface BootWorkspaceOptions {
  // the socket is inert, so whatever the server should already hold is seeded before the mount
  seed?: (harness: ThreadHarness) => Promise<void>;
  // the note the window opens on
  note?: string;
}

// the whole window over a booted server, mounted through the router the shell runs
export const bootWorkspace = async (options: BootWorkspaceOptions = {}): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routePageFetch(harness);
  await options.seed?.(harness);
  const entry =
    options.note === undefined
      ? "/"
      : `/?${new URLSearchParams({ note: options.note }).toString()}`;
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }));
  render(<RouterProvider router={router} />);
  await screen.findByRole("tablist", { name: "Panel tabs" });
  return harness;
};
