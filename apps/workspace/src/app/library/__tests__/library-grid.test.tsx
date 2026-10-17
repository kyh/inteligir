// @vitest-environment jsdom

// the grid's gestures over a listing larger than its loaded windows: a ⇧-click far from the anchor
// selects the whole span the listing holds between them, and under ⌘A a right-click or a drag acts
// on everything selected rather than collapsing it to one card.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { endInternalDrag, internalDrag } from "../drag-store";
import type { LibraryItemActions } from "../item-menu";
import { LibraryGrid } from "../library-grid";
import { createLibrarySelection } from "../library-selection";

const TOTAL = 1000;

const pathAt = (index: number): string => `Reading/item-${String(index).padStart(4, "0")}.md`;

const row = (index: number): ItemRowWire => ({
  author: null,
  bare: false,
  copy: null,
  cover: null,
  description: null,
  fetchError: null,
  fetched: null,
  file: null,
  fileBytes: null,
  folder: "Reading",
  host: null,
  id: null,
  kind: "note",
  modifiedMs: null,
  path: pathAt(index),
  pending: false,
  pinned: false,
  preview: "",
  published: null,
  saved: "2026-10-01T09:00:00Z",
  site: null,
  tags: [],
  title: `item ${String(index)}`,
  url: null,
});

const pageSchema = z.looseObject({ limit: z.number(), offset: z.number() });

const pathRequests: { offset: number; limit: number }[] = [];

beforeEach(() => {
  pathRequests.length = 0;
  // the grid's scroller is the one element with a box
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function width(
    this: Element,
  ) {
    return this instanceof HTMLElement && this.dataset.slot === "card-grid" ? 1024 : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function height(
    this: Element,
  ) {
    return this instanceof HTMLElement && this.dataset.slot === "card-grid" ? 768 : 0;
  });
  stubRpc({
    "knowledge/itemPaths": (input) => {
      const { limit, offset } = pageSchema.parse(input);
      pathRequests.push({ limit, offset });
      return {
        paths: Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, at) =>
          pathAt(offset + at),
        ),
      };
    },
    "knowledge/items": (input) => {
      const { limit, offset } = pageSchema.parse(input);
      return {
        items: Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, at) =>
          row(offset + at),
        ),
        kindCounts: { audio: 0, file: 0, image: 0, link: 0, note: TOTAL, pdf: 0, video: 0 },
        total: TOTAL,
      };
    },
    "system/status": () => ({
      agent: { state: "off" },
      dataDir: "/data",
      mediaToken: "media-token",
      schemaVersion: 1,
      uptimeMs: 1,
      vaultDir: "/vault",
      version: "0.0.0",
    }),
  });
});

afterEach(() => {
  cleanup();
  endInternalDrag();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const itemActions = (): LibraryItemActions => ({
  askAgent: vi.fn<LibraryItemActions["askAgent"]>(),
  keepCopy: vi.fn<LibraryItemActions["keepCopy"]>(),
  move: vi.fn<LibraryItemActions["move"]>(),
  open: vi.fn<LibraryItemActions["open"]>(),
  quickLook: vi.fn<LibraryItemActions["quickLook"]>(),
  refresh: vi.fn<LibraryItemActions["refresh"]>(),
  remove: vi.fn<LibraryItemActions["remove"]>(),
  rename: vi.fn<LibraryItemActions["rename"]>(),
  reveal: null,
  setPinned: vi.fn<LibraryItemActions["setPinned"]>(),
  tag: vi.fn<LibraryItemActions["tag"]>(),
});

const mount = (selection = createLibrarySelection()) => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <SidebarProvider>
        <LibraryGrid
          filter={{ kind: null, q: null, scope: { kind: "all" }, sort: "saved" }}
          total={TOTAL}
          selection={selection}
          scrollMemory={createStore<number>()(() => 0)}
          actions={itemActions()}
        />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return { selection };
};

const card = async (index: number): Promise<HTMLElement> => {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = document.querySelector<HTMLElement>(`[data-item-path="${pathAt(index)}"]`);
    expect(found).not.toBeNull();
  });
  if (found === null) {
    throw new Error(`no card for ${pathAt(index)}`);
  }
  return found;
};

const scroller = (): HTMLElement => {
  const grid = document.querySelector<HTMLElement>('[data-slot="card-grid"]');
  if (grid === null) {
    throw new Error("no grid");
  }
  return grid;
};

describe("a ⇧-click far from the anchor", () => {
  it("selects every item the listing holds between them, read from the listing", async () => {
    const { selection } = mount();
    fireEvent.click(await card(10));
    // far enough down that the anchor's window is no longer loaded
    act(() => {
      scroller().scrollTop = 40_000;
      scroller().dispatchEvent(new Event("scroll"));
    });
    let target = 0;
    await waitFor(() => {
      const shown = [...document.querySelectorAll<HTMLElement>("[data-item-path]")].map((element) =>
        Number(/item-(?<n>\d+)/u.exec(element.dataset.itemPath ?? "")?.groups?.n ?? "0"),
      );
      target = Math.max(0, ...shown);
      expect(target).toBeGreaterThan(400);
      expect(document.querySelector(`[data-item-path="${pathAt(0)}"]`)).toBeNull();
    });
    fireEvent.click(await card(target), { shiftKey: true });
    await waitFor(() => {
      expect(selection.store.getState().selected.size).toBe(target - 10 + 1);
    });
    expect(pathRequests).toContainEqual({ limit: target - 10 + 1, offset: 10 });
    const { selected } = selection.store.getState();
    expect(selected.has(pathAt(10))).toBe(true);
    expect(selected.has(pathAt(300))).toBe(true);
    expect(selected.has(pathAt(target))).toBe(true);
  });
});

describe("the focused card", () => {
  it("stays mounted and focused however far the grid scrolls from it", async () => {
    mount();
    const focused = await card(3);
    fireEvent.click(focused);
    focused.focus();
    act(() => {
      scroller().scrollTop = 40_000;
      scroller().dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => {
      const shown = [...document.querySelectorAll<HTMLElement>("[data-item-path]")].map((element) =>
        Number(/item-(?<n>\d+)/u.exec(element.dataset.itemPath ?? "")?.groups?.n ?? "0"),
      );
      expect(Math.max(0, ...shown)).toBeGreaterThan(400);
    });
    expect(focused.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
  });
});

describe("⌘A, then a gesture on one card", () => {
  it("keeps everything selected for the card's menu", async () => {
    const { selection } = mount();
    const first = await card(0);
    act(() => {
      selection.apply({ kind: "all" });
    });
    fireEvent.contextMenu(first);
    await waitFor(() => {
      expect(selection.store.getState().selected.size).toBe(TOTAL);
    });
    expect(selection.store.getState().all).toBe(false);
  });

  it("drags everything selected, every name once the listing answers", async () => {
    const { selection } = mount();
    const first = await card(0);
    act(() => {
      selection.apply({ kind: "all" });
    });
    fireEvent.dragStart(first, {
      dataTransfer: { effectAllowed: "none", setData: () => {} },
    });
    await waitFor(() => {
      expect(internalDrag()?.paths).toHaveLength(TOTAL);
    });
  });
});

const scrollFar = async (): Promise<number> => {
  act(() => {
    scroller().scrollTop = 40_000;
    scroller().dispatchEvent(new Event("scroll"));
  });
  let last = 0;
  await waitFor(() => {
    const shown = [...document.querySelectorAll<HTMLElement>("[data-item-path]")].map((element) =>
      Number(/item-(?<n>\d+)/u.exec(element.dataset.itemPath ?? "")?.groups?.n ?? "0"),
    );
    last = Math.max(0, ...shown);
    expect(last).toBeGreaterThan(400);
  });
  return last;
};

describe("an arrow", () => {
  it("steps from the focused card's own place in the listing, however far the grid scrolled", async () => {
    const { selection } = mount();
    // the last card of the first window, whose next is the first card of a window not loaded
    act(() => {
      scroller().scrollTop = 6400;
      scroller().dispatchEvent(new Event("scroll"));
    });
    const focused = await card(99);
    fireEvent.click(focused);
    await scrollFar();
    fireEvent.keyDown(focused, { key: "ArrowRight" });
    await waitFor(() => {
      expect(selection.store.getState().focus).toBe(pathAt(100));
    });
    expect([...selection.store.getState().selected]).toEqual([pathAt(100)]);
  });

  it("with nothing selected, lands on the card the keyboard is on", async () => {
    const { selection } = mount();
    const focused = await card(5);
    fireEvent.click(focused);
    focused.focus();
    fireEvent.keyDown(focused, { key: "Escape" });
    expect(selection.store.getState().focus).toBeNull();
    fireEvent.keyDown(focused, { key: "ArrowRight" });
    await waitFor(() => {
      expect(selection.store.getState().focus).toBe(pathAt(5));
    });
  });

  it("with ⇧ spans from an anchor the loaded windows no longer hold", async () => {
    const { selection } = mount();
    fireEvent.click(await card(5));
    const far = await scrollFar();
    const target = await card(far);
    fireEvent.click(target, { shiftKey: true });
    await waitFor(() => {
      expect(selection.store.getState().selected.size).toBe(far - 5 + 1);
    });
    fireEvent.keyDown(target, { key: "ArrowRight", shiftKey: true });
    await waitFor(() => {
      expect(selection.store.getState().focus).toBe(pathAt(far + 1));
    });
    expect(selection.store.getState().selected.size).toBe(far + 1 - 5 + 1);
    expect(selection.store.getState().anchor).toBe(pathAt(5));
  });
});

describe("the card that is to take the keyboard", () => {
  it("leaves it in a field the person is typing in", async () => {
    const selection = createLibrarySelection();
    selection.apply({ kind: "click", path: pathAt(3) });
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    mount(selection);
    await card(3);
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});
