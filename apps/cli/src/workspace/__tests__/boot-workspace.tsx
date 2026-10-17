import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { bootThreadHarness } from "../../server/__tests__/boot-app";
import type { ThreadHarness } from "../../server/__tests__/boot-app";
import { vi } from "vitest";

import type { ActionsPanelProps } from "@repo/workspace/app/actions/actions-panel";
import { createAppRouter } from "@repo/workspace/router";
import { routePageFetch } from "./booted-fetch";
import { InertSocket } from "@repo/workspace/test-support/inert-socket";

const noop = (): void => {};

// what a panel mounted on its own hands Info: the whole library as its subject, and no verbs
export const panelInfo = (): Pick<
  ActionsPanelProps,
  "subject" | "selectionCount" | "infoActions"
> => ({
  infoActions: {
    askAgent: noop,
    keepCopy: noop,
    move: noop,
    onRenameFolder: noop,
    onRenameTag: noop,
    open: noop,
    quickLook: noop,
    refresh: noop,
    remove: noop,
    rename: noop,
    reveal: null,
    setPinned: noop,
    tag: noop,
    withSelection: noop,
  },
  selectionCount: 0,
  subject: { kind: "scope", scope: { kind: "all" } },
});

export const chord = (key: string): KeyboardEventInit =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

export const sidebarState = (side: "left" | "right"): string | null =>
  document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`)?.dataset
    .state ?? null;

// jsdom lays nothing out, so the library's grid would draw no row: each grid reports the box a
// window gives it, which is all the virtualizer reads before its observer would fire
const sizedIfGrid = (element: Element, size: number): number =>
  element instanceof HTMLElement && element.dataset.slot === "card-grid" ? size : 0;

export const layOutCardGrids = (width = 1024, height = 768): void => {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function width_(
    this: Element,
  ) {
    return sizedIfGrid(this, width);
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function height_(
    this: Element,
  ) {
    return sizedIfGrid(this, height);
  });
};

export interface BootWorkspaceOptions {
  // the socket is inert, so whatever the server should already hold is seeded before the mount
  seed?: (harness: ThreadHarness) => Promise<void>;
  // the item the window opens on; the library when absent
  item?: string;
}

// the whole window over a booted server, mounted through the router the shell runs
export const bootWorkspace = async (options: BootWorkspaceOptions = {}): Promise<ThreadHarness> => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  layOutCardGrids();
  routePageFetch(harness);
  await options.seed?.(harness);
  const entry =
    options.item === undefined
      ? "/"
      : `/?${new URLSearchParams({ item: options.item }).toString()}`;
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }));
  render(<RouterProvider router={router} />);
  await screen.findByRole("tablist", { name: "Panel tabs" });
  return harness;
};
