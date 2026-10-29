import { existsSync, renameSync } from "node:fs";
import nodePath from "node:path";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bootTestApp } from "../server/test-support/boot-app";
import type { BootTestAppOptions } from "../server/test-support/boot-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREFS, readPref, writePref } from "@repo/workspace/app/prefs";
import { createAppRouter } from "@repo/workspace/router";
import { routePageFetch } from "./test-support/booted-fetch";
import { chord, layOutCardGrids, sidebarState } from "./test-support/boot-workspace";
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

// a double-click as the browser sends it: a click, a second click counting two, then the dblclick
const doubleClick = (target: HTMLElement): void => {
  fireEvent.click(target, { detail: 1 });
  fireEvent.click(target, { detail: 2 });
  fireEvent.doubleClick(target, { detail: 2 });
};

// Settings' own way back, which the item under it, covered inert, also names
const settingsBack = (): HTMLElement => {
  const main = screen.getByRole("heading", { name: "Settings" }).closest("main");
  if (!(main instanceof HTMLElement)) {
    throw new TypeError("Settings draws no main");
  }
  return within(main).getByRole("button", { name: "Back to library" });
};

// the item the window shows, by the item view's own mark; null is the library
const shownItem = (): string | null =>
  document.querySelector<HTMLElement>("[data-item-view]")?.dataset.itemPath ?? null;

// the bus's word that alpha.md moved to gamma.md, which a booted server's own broadcast never brings
const deliverAlphaMoved = (): void => {
  act(() => {
    ScriptedSocket.deliverToAll({
      changes: ["files-changed"],
      entity: "vault",
      paths: ["alpha.md", "gamma.md"],
      type: "changed",
    });
  });
};

const bootAt = async (
  history: RouterHistory,
  socket: typeof InertSocket | typeof ScriptedSocket = InertSocket,
  options: BootTestAppOptions = {},
) => {
  const booted = await bootTestApp(options);
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

describe("the palette's results in the library", () => {
  it("shows them over the whole library, wherever the grid was", async () => {
    // the window was on Deleted, which has no grid to filter
    writePref(PREFS.libraryScope, { kind: "deleted" });
    await bootAt(createMemoryHistory({ initialEntries: ["/"] }));
    await screen.findByRole("heading", { name: "Deleted" });
    fireEvent.keyDown(window, chord("p"));
    fireEvent.change(await screen.findByPlaceholderText("Search your library or run a command…"), {
      target: { value: "Alpha" },
    });
    fireEvent.click(
      await within(screen.getByRole("listbox")).findByText("Show all results in the library"),
    );
    await screen.findByRole("heading", { name: "All items" });
    expect(
      await screen.findByRole("button", { name: "Clear the search for “Alpha”" }),
    ).toBeTruthy();
    expect(readPref(PREFS.libraryScope)).toEqual({ kind: "all" });
  });
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

    doubleClick(await card("beta.md"));
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

describe("the keyboard's round trip through an item", () => {
  it("opens the focused card on Return, goes back on the first Escape, and lands on that card again", async () => {
    await bootAt(createMemoryHistory({ initialEntries: ["/"] }));
    await screen.findByRole("heading", { name: "All items" });
    const beta = await card("beta.md");
    fireEvent.click(beta);
    beta.focus();
    fireEvent.keyDown(beta, { key: "Enter" });
    await screen.findByRole("heading", { name: "Beta" });
    await waitFor(() => {
      expect(document.activeElement?.closest("[data-item-view]")).not.toBeNull();
    });
    const inItem = document.activeElement;
    if (inItem === null) {
      throw new Error("nothing holds the focus in the item");
    }
    // a note's body keeps its own Escape, so the item's own root is where the key goes back from
    const root = inItem.closest<HTMLElement>("[data-item-view]");
    fireEvent.keyDown(root ?? inItem, { key: "Escape" });
    await screen.findByRole("heading", { name: "All items" });
    await waitFor(async () => {
      expect(document.activeElement).toBe(await card("beta.md"));
    });
  });
});

describe("Settings over the workspace", () => {
  it("covers it inert with its chords stood down, and the way back finds it as it was", async () => {
    const { router } = await bootAt(createMemoryHistory({ initialEntries: ["/?item=alpha.md"] }));
    await screen.findByRole("heading", { name: "Alpha" });
    fireEvent.keyDown(window, chord("f"));
    await screen.findByPlaceholderText("Find…");
    fireEvent.keyDown(window, chord("k"));
    const composer = await screen.findByLabelText("Ask the agent");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    fireEvent.keyDown(window, chord(","));
    await screen.findByRole("heading", { name: "Settings" });
    expect(router.state.location.search).toEqual({ item: "alpha.md" });
    expect(composer.closest("[inert]")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Find…")).toBeNull();

    fireEvent.keyDown(window, chord("p"));
    fireEvent.keyDown(document.body, { key: "[" });
    await act(async () => {});
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sidebarState("left")).toBe("expanded");

    fireEvent.click(settingsBack());
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

    fireEvent.click(settingsBack());
    await waitFor(() => {
      expect(shownItem()).toBe("gamma.md");
    });
  });

  // the index says where an item went only once it has read the new path, and a read slower than
  // its deadline lands later: the window waits for that answer rather than drop the item
  it("keeps the open item while the index has not read where it moved, then follows it", async () => {
    const history = createMemoryHistory({ initialEntries: ["/?item=alpha.md"] });
    const searches: string[] = [];
    history.subscribe(() => {
      searches.push(history.location.search);
    });
    const { booted, router } = await bootAt(history, ScriptedSocket, {
      readDeadlineMs: 50,
      slowReads: { delayMs: 800, path: "gamma.md" },
    });
    await screen.findByRole("heading", { name: "Alpha" });

    // the move lands before the rename answers, whose alias write waits on the slow read
    const renamed = booted.client.vault.rename({ from: "alpha.md", to: "gamma.md" });
    await vi.waitFor(() => {
      expect(existsSync(nodePath.join(booted.vaultDir, "gamma.md"))).toBe(true);
      expect(existsSync(nodePath.join(booted.vaultDir, "alpha.md"))).toBe(false);
    });
    act(() => {
      ScriptedSocket.deliverToAll({
        changes: ["files-changed"],
        entity: "vault",
        paths: ["alpha.md", "gamma.md"],
        type: "changed",
      });
    });
    await renamed;

    await waitFor(
      () => {
        expect(router.state.location.search).toEqual({ item: "gamma.md" });
      },
      { timeout: 10_000 },
    );
    expect(searches.filter((search) => !search.includes("item="))).toEqual([]);
    await screen.findByRole("heading", { name: "Alpha" }, { timeout: 10_000 });
    expect(shownItem()).toBe("gamma.md");
  });

  // the index is told of a move only after it is on disk: the server's own move reports after its
  // fsyncs, a watched one after the watcher's debounce. this boot has no watcher, so a move made on
  // disk holds that window open until the suite tells the index, as the watcher's batch would
  it("keeps the open item while the index has not been told where it moved, then follows it", async () => {
    const history = createMemoryHistory({ initialEntries: ["/?item=alpha.md"] });
    const searches: string[] = [];
    history.subscribe(() => {
      searches.push(history.location.search);
    });
    const { booted, router } = await bootAt(history, ScriptedSocket);
    await screen.findByRole("heading", { name: "Alpha" });
    const { knowledge } = booted.composed.context;
    const asked = vi.spyOn(knowledge, "pathForNoteId");

    renameSync(
      nodePath.join(booted.vaultDir, "alpha.md"),
      nodePath.join(booted.vaultDir, "gamma.md"),
    );
    deliverAlphaMoved();
    // the window's first ask has its answer from an index that still names alpha.md
    await vi.waitFor(() => {
      expect(asked.mock.settledResults[0]?.type).toBe("fulfilled");
    });

    knowledge.invalidate({ kind: "paths", paths: ["alpha.md", "gamma.md"] });
    deliverAlphaMoved();

    await waitFor(
      () => {
        expect(router.state.location.search).toEqual({ item: "gamma.md" });
      },
      { timeout: 10_000 },
    );
    expect(searches.filter((search) => !search.includes("item="))).toEqual([]);
    await screen.findByRole("heading", { name: "Alpha" }, { timeout: 10_000 });
    expect(shownItem()).toBe("gamma.md");
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
