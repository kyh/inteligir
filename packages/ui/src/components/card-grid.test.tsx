// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CardGrid } from "./card-grid";
import type { CardGridHandle } from "./card-grid";
import { MediaCard, mediaCardHeight } from "./media-card";

/* oxlint-disable anti-slop/no-runtime-typeof -- feature detection over host objects: jsdom has
   no ResizeObserver, which the grid observes its box with. */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== "function") {
    /* oxlint-disable class-methods-use-this -- the observer's instance API */
    class ResizeObserverStub {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    }
    /* oxlint-enable class-methods-use-this */
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});
/* oxlint-enable anti-slop/no-runtime-typeof */

afterEach(cleanup);

// 800 wide less 16 either side is 768: four columns of 180 with three gaps of 16
const RECT = { height: 600, width: 800 };

const mount = (props: Partial<ComponentProps<typeof CardGrid>> = {}) =>
  render(
    <div style={{ height: 600 }}>
      <CardGrid
        aria-label="Library"
        count={1000}
        minCellWidth={180}
        cellHeight={mediaCardHeight}
        initialRect={RECT}
        renderCell={(index) => <MediaCard aria-label={`card ${String(index)}`} />}
        {...props}
      />
    </div>,
  );

const drawnCells = (): string[] =>
  screen.getAllByRole("gridcell").map((cell) => cell.getAttribute("aria-label") ?? "");

describe("the card grid", () => {
  it("lays the width out in as many columns as fit, and counts its rows", () => {
    const onColumnsChange = vi.fn<(columns: number) => void>();
    mount({ onColumnsChange });
    expect(onColumnsChange).toHaveBeenLastCalledWith(4);
    const grid = screen.getByRole("grid", { name: "Library" });
    expect(grid.getAttribute("aria-rowcount")).toBe("250");
    expect(grid.getAttribute("aria-colcount")).toBe("4");
  });

  it("mounts the rows in view and a few past them, never the whole count", () => {
    mount();
    const cells = drawnCells();
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(60);
    expect(cells[0]).toBe("card 0");
    expect(cells.length % 4).toBe(0);
  });

  it("keeps the roving cell mounted however far it is from the view", () => {
    mount({ keepMountedIndex: 901 });
    expect(drawnCells()).toContain("card 901");
    expect(drawnCells()).not.toContain("card 905");
  });

  it("ends the last row at the count", () => {
    mount({ count: 6 });
    expect(drawnCells()).toEqual(["card 0", "card 1", "card 2", "card 3", "card 4", "card 5"]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("says which cells are in view", () => {
    const onRangeChange = vi.fn<(range: { first: number; last: number }) => void>();
    mount({ onRangeChange });
    const last = onRangeChange.mock.lastCall?.[0];
    expect(last?.first).toBe(0);
    expect(last?.last).toBeGreaterThan(3);
    expect(last?.last).toBeLessThan(40);
  });

  it("is a single column when the box is narrower than one cell", () => {
    const onColumnsChange = vi.fn<(columns: number) => void>();
    mount({ initialRect: { height: 600, width: 120 }, onColumnsChange });
    expect(onColumnsChange).toHaveBeenLastCalledWith(1);
  });

  it("hands its scroll to a handle", () => {
    const handleRef = createRef<CardGridHandle>();
    mount({ handleRef });
    expect(handleRef.current?.scrollToCell).toBeTypeOf("function");
  });
});
