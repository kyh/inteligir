// @vitest-environment jsdom

import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemCard } from "./item-card";
import type { ListedItem } from "./listing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SAVED = 1_700_000_000_000;
const REASON = "The page answered 404: it may have moved.";

const fields = (patch: Partial<LibraryItemFields>): LibraryItemFields => ({
  aliases: [],
  author: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "link",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: SAVED,
  site: "example.com",
  tags: [],
  title: "Moved away",
  url: "https://example.com/moved",
  ...patch,
});

const linkRow = (patch: Partial<LibraryItemFields>): ListedItem => {
  const itemFields = fields(patch);
  return {
    card: { outline: [], preview: "", title: itemFields.title, words: 0 },
    fields: itemFields,
    id: "0199a4c2-0000-7000-8000-0000000000a1",
    seq: 1,
    tags: itemFields.tags,
    updatedAt: SAVED,
  };
};

const drawCard = (row: ListedItem) => {
  const onPress = vi.fn<() => void>();
  const onOpen = vi.fn<() => void>();
  const onMenu = vi.fn<() => void>();
  render(
    <ItemCard
      row={row}
      selected={false}
      tabStop
      nowMs={SAVED}
      onPress={onPress}
      onOpen={onOpen}
      onMenu={onMenu}
    />,
  );
  return { onMenu, onOpen, onPress };
};

const badge = (): HTMLElement => screen.getByText("Page not read");

// Base UI opens a hover popover on its own delay, so the clock runs past it
const hover = (element: HTMLElement): void => {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
  fireEvent.mouseMove(element);
  act(() => {
    vi.advanceTimersByTime(600);
  });
};

const reason = (): HTMLElement => within(screen.getByRole("dialog")).getByText(REASON);

describe("a card with no title and no words", () => {
  it("is called Untitled, to the eye and to a screen reader", () => {
    drawCard(linkRow({ title: "" }));
    expect(screen.getByRole("gridcell", { name: "Untitled" }).textContent).toContain("Untitled");
  });
});

describe("a card whose page went unread", () => {
  it("draws no badge when the page was read", () => {
    drawCard(linkRow({}));
    expect(screen.queryByText("Page not read")).toBeNull();
  });

  it("says why on a hover, in a popover whose text can be selected", () => {
    drawCard(linkRow({ fetchError: REASON }));
    expect(screen.queryByText(REASON)).toBeNull();
    hover(badge());
    expect(reason().closest("[data-slot='popover-content']")?.className).toContain("select-text");
  });

  // a tooltip is off on touch, so the reason opens on a tap too
  it("says why on a click, which selects the card as a click anywhere on it does", () => {
    const { onOpen, onPress } = drawCard(linkRow({ fetchError: REASON }));
    act(() => {
      fireEvent.click(badge(), { detail: 1 });
    });
    expect(reason()).toBeDefined();
    expect(onPress).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  // the popover is the card's child in React's tree, so its events reach the card's handlers
  // unless the card asks where they landed
  it("keeps a click, a double-click or a right-click in the reason off the card", () => {
    const { onMenu, onOpen, onPress } = drawCard(linkRow({ fetchError: REASON }));
    hover(badge());
    fireEvent.click(reason(), { detail: 1 });
    fireEvent.click(reason(), { detail: 2 });
    fireEvent.contextMenu(reason());
    expect(onPress).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
    expect(reason()).toBeDefined();
  });
});
