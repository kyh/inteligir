import { describe, expect, it } from "vitest";

import { createLibrarySelection, selectedIn, selectionAfter, targetOf } from "./library-selection";
import type { LibrarySelection, SelectionGesture } from "./library-selection";

const ORDER = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ROWS = ORDER.map((id) => ({ id }));
const WHOLE = { items: ROWS, total: ROWS.length };
const PARTLY_READ = { items: ROWS, total: 8512 };

const NONE: LibrarySelection = {
  anchor: null,
  focus: null,
  selected: { ids: new Set(), kind: "ids" },
};

const run = (...gestures: SelectionGesture[]) => {
  let state = NONE;

  for (const gesture of gestures) {
    state = selectionAfter(state, gesture);
  }

  return state;
};

const move = (delta: "left" | "right" | "up" | "down" | "first" | "last", extend = false) =>
  ({ columns: 3, delta, extend, kind: "move", order: ORDER }) satisfies SelectionGesture;

const names = (s: LibrarySelection) => selectedIn(s.selected, WHOLE).rows.map((row) => row.id);

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

describe("select all and clear", () => {
  it("selects the scope with ⌘A, read or not, and leaves out what a ⌘-click takes away", () => {
    const s = run({ id: "a", kind: "click" }, { kind: "all" }, { id: "c", kind: "toggle" });
    expect(names(s)).toStrictEqual(["a", "b", "d", "e", "f", "g", "h"]);
    expect(selectedIn(s.selected, PARTLY_READ).count).toBe(8511);
    expect(names(selectionAfter(s, { id: "c", kind: "toggle" }))).toStrictEqual(ORDER);
  });

  it("clears everything", () => {
    expect(run({ id: "a", kind: "click" }, { kind: "all" }, { kind: "clear" })).toStrictEqual(NONE);
  });

  it("selects nothing by an id the listing no longer shows", () => {
    const s = run({ kind: "click", id: "a" }, { kind: "toggle", id: "gone" });
    expect(selectedIn(s.selected, WHOLE)).toStrictEqual({ count: 1, rows: [{ id: "a" }] });
  });
});

describe("what a verb takes of the selection", () => {
  const everything = { kind: null, scope: { kind: "all" } } as const;

  it("is its items by id while the grid read every one of them", () => {
    const all = run({ kind: "all" }, { id: "c", kind: "toggle" });
    expect(targetOf(all.selected, WHOLE, everything)).toStrictEqual({
      ids: ["a", "b", "d", "e", "f", "g", "h"],
      kind: "ids",
    });
    const clicked = run({ id: "b", kind: "click" });
    expect(targetOf(clicked.selected, PARTLY_READ, everything)).toStrictEqual({
      ids: ["b"],
      kind: "ids",
    });
  });

  it("is the scope, its kind and those left out once ⌘A reaches past what the grid read", () => {
    const all = run({ kind: "all" }, { id: "c", kind: "toggle" });
    expect(
      targetOf(all.selected, PARTLY_READ, { kind: "pdf", scope: { kind: "tag", tag: "field" } }),
    ).toStrictEqual({
      count: 8511,
      kind: "scope",
      swept: { except: ["c"], kinds: ["pdf"], scope: { kind: "tag", tag: "field" } },
    });
    expect(targetOf(run({ kind: "all" }).selected, PARTLY_READ, everything)).toStrictEqual({
      count: 8512,
      kind: "scope",
      swept: { except: [], scope: { kind: "all" } },
    });
  });

  it("is nothing while the grid still shows the listing of the scope the tab left", () => {
    expect(targetOf(run({ kind: "all" }).selected, PARTLY_READ, null)).toBeNull();
    expect(targetOf(run({ id: "b", kind: "click" }).selected, WHOLE, null)).toBeNull();
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
    selection.apply({ columns: 3, delta: "down", extend: false, kind: "move", order: [] });
    expect(seen).toHaveLength(1);
    expect(names(selection.store.getState())).toStrictEqual(["a"]);
  });
});
