import { describe, expect, it } from "vitest";

import { createLibrarySelection, selectionAfter, selectionCount } from "./library-selection";
import type { LibrarySelection, SelectionGesture } from "./library-selection";

const ORDER = ["a", "b", "c", "d", "e", "f", "g", "h"];

const NONE: LibrarySelection = { all: false, anchor: null, focus: null, selected: new Set() };

const run = (...gestures: SelectionGesture[]): LibrarySelection => {
  let state = NONE;
  for (const gesture of gestures) {
    state = selectionAfter(state, gesture);
  }
  return state;
};

// an arrow over a grid three columns wide
const move = (
  delta: "left" | "right" | "up" | "down" | "first" | "last",
  extend = false,
): SelectionGesture => ({ columns: 3, delta, extend, kind: "move", order: ORDER });

const names = (s: LibrarySelection): string[] => [...s.selected].toSorted();

describe("a click and its modifiers, as Finder reads them", () => {
  it("selects one item with a click, replacing what was selected", () => {
    const s = run({ kind: "click", path: "a" }, { kind: "click", path: "c" });
    expect(names(s)).toEqual(["c"]);
    expect(s.anchor).toBe("c");
    expect(s.focus).toBe("c");
  });

  it("adds and takes away one item with ⌘-click, keeping the rest", () => {
    const s = run(
      { kind: "click", path: "a" },
      { kind: "toggle", path: "c" },
      { kind: "toggle", path: "e" },
      { kind: "toggle", path: "a" },
    );
    expect(names(s)).toEqual(["c", "e"]);
    expect(s.anchor).toBe("a");
  });

  it("extends from the anchor to the item with ⇧-click, in either direction", () => {
    expect(
      names(run({ kind: "click", path: "b" }, { kind: "range", order: ORDER, path: "e" })),
    ).toEqual(["b", "c", "d", "e"]);
    const back = run(
      { kind: "click", path: "e" },
      { kind: "range", order: ORDER, path: "e" },
      { kind: "range", order: ORDER, path: "c" },
    );
    expect(names(back)).toEqual(["c", "d", "e"]);
    expect(back.anchor).toBe("e");
    expect(back.focus).toBe("c");
  });

  it("anchors a ⇧-click with nothing selected at the item itself", () => {
    expect(names(run({ kind: "range", order: ORDER, path: "d" }))).toEqual(["d"]);
  });
});

describe("the arrows over the grid's order", () => {
  it("moves the focus and the selection with it, a row at a time up and down", () => {
    const s = run({ kind: "click", path: "b" }, move("down"));
    expect(names(s)).toEqual(["e"]);
    expect(run({ kind: "click", path: "e" }, move("up")).focus).toBe("b");
    expect(run({ kind: "click", path: "e" }, move("left")).focus).toBe("d");
    expect(run({ kind: "click", path: "e" }, move("right")).focus).toBe("f");
  });

  it("stays put past either edge", () => {
    expect(run({ kind: "click", path: "a" }, move("up")).focus).toBe("a");
    expect(run({ kind: "click", path: "h" }, move("right")).focus).toBe("h");
    expect(run({ kind: "click", path: "g" }, move("down")).focus).toBe("g");
  });

  it("goes to either end", () => {
    expect(run({ kind: "click", path: "d" }, move("first")).focus).toBe("a");
    expect(run({ kind: "click", path: "d" }, move("last")).focus).toBe("h");
  });

  it("extends from the anchor with ⇧", () => {
    const s = run({ kind: "click", path: "b" }, move("right", true), move("down", true));
    expect(names(s)).toEqual(["b", "c", "d", "e", "f"]);
    expect(s.anchor).toBe("b");
    expect(s.focus).toBe("f");
  });

  it("starts from the first item when nothing has the focus", () => {
    expect(run(move("right")).focus).toBe("a");
    expect(run(move("last")).focus).toBe("h");
  });

  it("does nothing over an empty grid", () => {
    expect(run({ columns: 3, delta: "down", extend: false, kind: "move", order: [] })).toEqual(
      NONE,
    );
  });
});

describe("select all, clear and prune", () => {
  it("says every item in the scope with ⌘A, counted by the scope's total", () => {
    const s = run({ kind: "click", path: "a" }, { kind: "all" });
    expect(s.all).toBe(true);
    expect(selectionCount(s, 8512)).toBe(8512);
    expect(selectionCount(run({ kind: "click", path: "a" }), 8512)).toBe(1);
  });

  it("names what ⌘A stood for once the caller has read it, and edits from there", () => {
    const s = run(
      { kind: "all" },
      { kind: "materialize", paths: ORDER },
      { kind: "toggle", path: "c" },
    );
    expect(s.all).toBe(false);
    expect(names(s)).toEqual(["a", "b", "d", "e", "f", "g", "h"]);
  });

  it("clears everything", () => {
    expect(run({ kind: "click", path: "a" }, { kind: "all" }, { kind: "clear" })).toEqual(NONE);
  });

  it("takes items that left the library out, and the focus with them", () => {
    const s = run(
      { kind: "click", path: "a" },
      { kind: "toggle", path: "b" },
      { gone: new Set(["b", "z"]), kind: "prune" },
    );
    expect(names(s)).toEqual(["a"]);
    expect(s.focus).toBeNull();
    expect(s.anchor).toBeNull();
  });

  it("follows an item that moved under it, keeping its focus and anchor", () => {
    const s = run(
      { kind: "click", path: "Unsorted/a.md" },
      { kind: "toggle", path: "b" },
      { kind: "toggle", path: "Unsorted/a.md" },
      { kind: "toggle", path: "Unsorted/a.md" },
      { kind: "moved", moves: new Map([["Unsorted/a.md", "Unsorted/A page.md"]]) },
    );
    expect(names(s)).toEqual(["Unsorted/A page.md", "b"]);
    expect(s.focus).toBe("Unsorted/A page.md");
    expect(s.anchor).toBe("Unsorted/A page.md");
    const before = run({ kind: "click", path: "a" });
    expect(selectionAfter(before, { kind: "moved", moves: new Map([["z", "y"]]) })).toBe(before);
  });

  it("answers the same selection when nothing it holds left", () => {
    const before = run({ kind: "click", path: "a" });
    expect(selectionAfter(before, { gone: new Set(["z"]), kind: "prune" })).toBe(before);
  });
});

describe("the store", () => {
  it("publishes a gesture's answer, and nothing for a gesture that changed nothing", () => {
    const selection = createLibrarySelection();
    const seen: LibrarySelection[] = [];
    selection.store.subscribe((state) => {
      seen.push(state);
    });
    selection.apply({ kind: "click", path: "a" });
    selection.apply({ gone: new Set(["z"]), kind: "prune" });
    expect(seen).toHaveLength(1);
    expect(names(selection.store.getState())).toEqual(["a"]);
  });
});
