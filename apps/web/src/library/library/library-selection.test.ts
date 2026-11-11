import { describe, expect, it } from "vitest";

import { createLibrarySelection, selectionAfter } from "./library-selection";
import type { LibrarySelection, SelectionGesture } from "./library-selection";

const ORDER = ["a", "b", "c", "d", "e", "f", "g", "h"];

const NONE: LibrarySelection = { anchor: null, focus: null, selected: new Set() };

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
    const s = run({ kind: "click", id: "a" }, { kind: "click", id: "c" });
    expect(names(s)).toStrictEqual(["c"]);
    expect(s.anchor).toBe("c");
    expect(s.focus).toBe("c");
  });

  it("adds and takes away one item with ⌘-click, keeping the rest", () => {
    const s = run(
      { kind: "click", id: "a" },
      { kind: "toggle", id: "c" },
      { kind: "toggle", id: "e" },
      { kind: "toggle", id: "a" },
    );
    expect(names(s)).toStrictEqual(["c", "e"]);
    expect(s.anchor).toBe("a");
  });

  it("extends from the anchor to the item with ⇧-click, in either direction", () => {
    expect(
      names(run({ kind: "click", id: "b" }, { kind: "range", order: ORDER, id: "e" })),
    ).toStrictEqual(["b", "c", "d", "e"]);
    const back = run(
      { kind: "click", id: "e" },
      { kind: "range", order: ORDER, id: "e" },
      { kind: "range", order: ORDER, id: "c" },
    );
    expect(names(back)).toStrictEqual(["c", "d", "e"]);
    expect(back.anchor).toBe("e");
    expect(back.focus).toBe("c");
  });

  it("anchors a ⇧-click with nothing selected at the item itself", () => {
    expect(names(run({ kind: "range", order: ORDER, id: "d" }))).toStrictEqual(["d"]);
  });
});

describe("the arrows over the grid's order", () => {
  it("moves the focus and the selection with it, a row at a time up and down", () => {
    const s = run({ kind: "click", id: "b" }, move("down"));
    expect(names(s)).toStrictEqual(["e"]);
    expect(run({ kind: "click", id: "e" }, move("up")).focus).toBe("b");
    expect(run({ kind: "click", id: "e" }, move("left")).focus).toBe("d");
    expect(run({ kind: "click", id: "e" }, move("right")).focus).toBe("f");
  });

  it("stays put past either edge", () => {
    expect(run({ kind: "click", id: "a" }, move("up")).focus).toBe("a");
    expect(run({ kind: "click", id: "h" }, move("right")).focus).toBe("h");
    expect(run({ kind: "click", id: "g" }, move("down")).focus).toBe("g");
  });

  it("goes to either end", () => {
    expect(run({ kind: "click", id: "d" }, move("first")).focus).toBe("a");
    expect(run({ kind: "click", id: "d" }, move("last")).focus).toBe("h");
  });

  it("extends from the anchor with ⇧", () => {
    const s = run({ kind: "click", id: "b" }, move("right", true), move("down", true));
    expect(names(s)).toStrictEqual(["b", "c", "d", "e", "f"]);
    expect(s.anchor).toBe("b");
    expect(s.focus).toBe("f");
  });

  it("starts from the first item when nothing has the focus", () => {
    expect(run(move("right")).focus).toBe("a");
    expect(run(move("last")).focus).toBe("h");
  });

  it("does nothing over an empty grid", () => {
    expect(
      run({ columns: 3, delta: "down", extend: false, kind: "move", order: [] }),
    ).toStrictEqual(NONE);
  });
});

describe("select all, clear and prune", () => {
  it("selects every item in the scope with ⌘A, and edits from there", () => {
    const s = run(
      { id: "a", kind: "click" },
      { kind: "all", order: ORDER },
      { id: "c", kind: "toggle" },
    );
    expect(names(s)).toStrictEqual(["a", "b", "d", "e", "f", "g", "h"]);
  });

  it("clears everything", () => {
    expect(
      run({ id: "a", kind: "click" }, { kind: "all", order: ORDER }, { kind: "clear" }),
    ).toStrictEqual(NONE);
  });

  it("takes items that left the library out, and the focus with them", () => {
    const s = run(
      { kind: "click", id: "a" },
      { kind: "toggle", id: "b" },
      { gone: new Set(["b", "z"]), kind: "prune" },
    );
    expect(names(s)).toStrictEqual(["a"]);
    expect(s.focus).toBeNull();
    expect(s.anchor).toBeNull();
  });

  it("answers the same selection when nothing it holds left", () => {
    const before = run({ kind: "click", id: "a" });
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
    selection.apply({ kind: "click", id: "a" });
    selection.apply({ gone: new Set(["z"]), kind: "prune" });
    expect(seen).toHaveLength(1);
    expect(names(selection.store.getState())).toStrictEqual(["a"]);
  });
});
