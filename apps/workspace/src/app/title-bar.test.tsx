// @vitest-environment jsdom

import { ThemeProvider } from "@repo/ui/lib/theme";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearShell, mockShell } from "../shell/test-support/mock-shell";
import { AppearanceProvider } from "./appearance";
import { SettingsPage } from "./settings/settings-page";
import { fakePageLibrary, renderOnLibrary } from "./test-support/fake-page-library";
import { Workspace } from "./workspace";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const ITEM = "0199a4c2-0000-7000-8000-0000000000b1";
// the bar's left inset, the one thing a suite without layout can read of the corner
const CLEAR_OF_THE_LIGHTS = "pl-[4.5rem]";
const CLEAR_BELOW_THE_BREAKPOINT = `max-md:${CLEAR_OF_THE_LIGHTS}`;

const inABrowserTab = (): void => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC);
};

const underTheShellOn = (userAgent: string): void => {
  mockShell();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
};

const emptyLibrary = () => {
  const { library } = fakePageLibrary({ answer: () => ({}) });
  return {
    ...library,
    replica: {
      ...library.replica,
      annotations: async () => await Promise.resolve({}),
      focus: () => {
        // this library never moves, so there is nothing to catch up on
      },
      folders: () => [],
      item: async () => await Promise.resolve(null),
      listing: () => ({
        items: [],
        kindCounts: { audio: 0, file: 0, image: 0, link: 0, note: 0, pdf: 0, video: 0 },
        total: 0,
      }),
      scopes: () => ({ folders: [], total: 0, unsorted: 0, untagged: 0 }),
    },
  };
};

const openWorkspace = (openItem: string | null): void => {
  const routeTree = createRootRoute({
    component: () => (
      <Workspace
        covered={false}
        openItem={openItem}
        onOpenItem={() => {
          // an item this suite opens stays open
        }}
      />
    ),
  });
  renderOnLibrary(
    <RouterProvider router={createRouter({ history: createMemoryHistory(), routeTree })} />,
    emptyLibrary(),
  );
};

const barOf = (element: HTMLElement): HTMLElement => {
  const bar = element.closest("header");
  if (bar === null) {
    throw new Error("nothing here sits in a top bar");
  }
  return bar;
};

const libraryBar = async (): Promise<HTMLElement> => {
  openWorkspace(null);
  return barOf(await screen.findByRole("heading", { name: "All items" }));
};

const itemBar = async (): Promise<HTMLElement> => {
  openWorkspace(ITEM);
  return barOf(await screen.findByRole("button", { name: "Back to the library" }));
};

const toggleRail = (): void => {
  fireEvent.keyDown(document.body, { key: "[" });
};

const railHeader = (): HTMLElement => {
  const header = document.querySelector<HTMLElement>('[data-sidebar="header"]');
  if (header === null) {
    throw new Error("the rail draws no header");
  }
  return header;
};

const firstChildOf = (parent: HTMLElement): HTMLElement => {
  const child = parent.firstElementChild;
  if (!(child instanceof HTMLElement)) {
    throw new TypeError("this surface draws nothing");
  }
  return child;
};

const expectDragStrip = (strip: HTMLElement): void => {
  expect(strip.dataset.tauriDragRegion).toBe("true");
  expect(strip.childElementCount).toBe(0);
};

afterEach(() => {
  cleanup();
  clearShell();
  vi.restoreAllMocks();
});

describe("the window's top edge under the Mac's shell", () => {
  it("opens the rail on a childless strip that drags the window", async () => {
    underTheShellOn(MAC);
    await libraryBar();
    expectDragStrip(firstChildOf(railHeader()));
    expect(within(railHeader()).getByText("Library")).toBeDefined();
  });

  it.each([
    ["the library's", libraryBar],
    ["an open item's", itemBar],
  ])("keeps %s bar clear of the lights only while the rail is off screen", async (_bar, opened) => {
    underTheShellOn(MAC);
    const bar = await opened();
    expect(bar.classList.contains(CLEAR_OF_THE_LIGHTS)).toBe(false);
    expect(bar.classList.contains(CLEAR_BELOW_THE_BREAKPOINT)).toBe(true);
    toggleRail();
    await waitFor(() => {
      expect(bar.classList.contains(CLEAR_OF_THE_LIGHTS)).toBe(true);
    });
    toggleRail();
    await waitFor(() => {
      expect(bar.classList.contains(CLEAR_OF_THE_LIGHTS)).toBe(false);
    });
  });

  it.each([
    ["the library's", libraryBar],
    ["an open item's", itemBar],
  ])(
    "drags the window by whatever a press lands on in %s bar, all there is to drag with the rail closed",
    async (_bar, opened) => {
      underTheShellOn(MAC);
      const bar = await opened();
      expect(bar.dataset.tauriDragRegion).toBe("deep");
    },
  );

  it("keeps Settings' way back below the lights", () => {
    underTheShellOn(MAC);
    renderOnLibrary(
      <ThemeProvider
        theme="system"
        setTheme={() => {
          // the suite reads where the button sits and changes nothing
        }}
      >
        <AppearanceProvider>
          <SettingsPage
            onBack={() => {
              // the suite reads where the button sits and presses nothing
            }}
          />
        </AppearanceProvider>
      </ThemeProvider>,
      emptyLibrary(),
    );
    const strip = firstChildOf(screen.getByRole("navigation", { name: "Settings" }));
    expectDragStrip(strip);
    expect(strip.nextElementSibling).toBe(screen.getByRole("button", { name: "Library" }));
  });
});

describe("the window's top edge with a title bar of its own", () => {
  it.each([
    [
      "the shell on Linux",
      () => {
        underTheShellOn(LINUX);
      },
    ],
    ["a browser tab", inABrowserTab],
  ])("reserves nothing in %s", async (_where, arrange) => {
    arrange();
    const bar = await libraryBar();
    expect(railHeader().querySelector("[data-tauri-drag-region]")).toBeNull();
    expect(bar.dataset.tauriDragRegion).toBeUndefined();
    expect(bar.classList.contains(CLEAR_BELOW_THE_BREAKPOINT)).toBe(false);
    toggleRail();
    await waitFor(() => {
      expect(document.querySelector<HTMLElement>('[data-slot="sidebar"]')?.dataset.state).toBe(
        "collapsed",
      );
    });
    expect(bar.classList.contains(CLEAR_OF_THE_LIGHTS)).toBe(false);
  });
});
