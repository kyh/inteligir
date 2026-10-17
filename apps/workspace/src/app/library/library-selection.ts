// CLAUDE.md § THE GRID'S SELECTION IS A STORE. Finder's grammar: a click selects, ⌘-click toggles,
// ⇧-click extends from the anchor, and an arrow moves the focus and the selection with it. ⌘A is
// `all`, a statement about the scope rather than a list of names, since the grid has only the
// rows it has loaded; the caller materializes it through `knowledge.itemPaths` before any gesture
// that needs the names. The store is created once by the workspace, so leaving for an item and
// coming back finds the selection as it was left.

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

export interface LibrarySelection {
  selected: ReadonlySet<string>;
  all: boolean;
  anchor: string | null;
  focus: string | null;
}

export type MoveDelta = "left" | "right" | "up" | "down" | "first" | "last";

export type SelectionGesture =
  | { kind: "click"; path: string }
  | { kind: "toggle"; path: string }
  | { kind: "range"; path: string; order: readonly string[] }
  | {
      kind: "move";
      delta: MoveDelta;
      extend: boolean;
      order: readonly string[];
      columns: number;
    }
  | { kind: "all" }
  | { kind: "clear" }
  | { kind: "prune"; gone: ReadonlySet<string> }
  // the names an `all` stood for, once the caller has read them
  | { kind: "materialize"; paths: readonly string[] };

const EMPTY_SELECTION: LibrarySelection = {
  all: false,
  anchor: null,
  focus: null,
  selected: new Set(),
};

// the paths between two in the grid's order, both ends included; one alone when either is absent
const spanOf = (order: readonly string[], from: string, to: string): Set<string> => {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) {
    return new Set([to]);
  }
  return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
};

const stepped = (
  order: readonly string[],
  focus: string | null,
  delta: MoveDelta,
  columns: number,
): string | null => {
  if (order.length === 0) {
    return null;
  }
  const at = focus === null ? -1 : order.indexOf(focus);
  if (at === -1) {
    return delta === "last" ? (order.at(-1) ?? null) : (order[0] ?? null);
  }
  const step = {
    down: columns,
    first: -at,
    last: order.length - 1 - at,
    left: -1,
    right: 1,
    up: -columns,
  }[delta];
  const next = at + step;
  // a step past either edge stays put, as Finder's does
  return next < 0 || next >= order.length ? (order[at] ?? null) : (order[next] ?? null);
};

export const selectionAfter = (s: LibrarySelection, g: SelectionGesture): LibrarySelection => {
  switch (g.kind) {
    case "click": {
      return { all: false, anchor: g.path, focus: g.path, selected: new Set([g.path]) };
    }
    case "toggle": {
      const selected = new Set(s.selected);
      if (selected.has(g.path)) {
        selected.delete(g.path);
      } else {
        selected.add(g.path);
      }
      return { all: false, anchor: g.path, focus: g.path, selected };
    }
    case "range": {
      const anchor = s.anchor ?? g.path;
      return { all: false, anchor, focus: g.path, selected: spanOf(g.order, anchor, g.path) };
    }
    case "move": {
      const focus = stepped(g.order, s.focus, g.delta, Math.max(1, g.columns));
      if (focus === null) {
        return s;
      }
      if (g.extend) {
        const anchor = s.anchor ?? s.focus ?? focus;
        return { all: false, anchor, focus, selected: spanOf(g.order, anchor, focus) };
      }
      return { all: false, anchor: focus, focus, selected: new Set([focus]) };
    }
    case "all": {
      return { ...s, all: true };
    }
    case "clear": {
      return EMPTY_SELECTION;
    }
    case "prune": {
      if (![...s.selected].some((path) => g.gone.has(path)) && !g.gone.has(s.focus ?? "")) {
        return s;
      }
      const keep = (path: string | null): string | null =>
        path !== null && g.gone.has(path) ? null : path;
      return {
        all: s.all,
        anchor: keep(s.anchor),
        focus: keep(s.focus),
        selected: new Set([...s.selected].filter((path) => !g.gone.has(path))),
      };
    }
    case "materialize": {
      return { ...s, all: false, selected: new Set(g.paths) };
    }
    default: {
      const exhaustive: never = g;
      return exhaustive;
    }
  }
};

export interface LibrarySelectionStore {
  readonly store: StoreApi<LibrarySelection>;
  apply: (gesture: SelectionGesture) => void;
}

export const createLibrarySelection = (): LibrarySelectionStore => {
  const store = createStore<LibrarySelection>()(() => EMPTY_SELECTION);
  return {
    apply: (gesture) => {
      const before = store.getState();
      const after = selectionAfter(before, gesture);
      if (after !== before) {
        store.setState(after, true);
      }
    },
    store,
  };
};

// how many items a selection stands for: every item in the scope when `all`
export const selectionCount = (s: LibrarySelection, total: number): number =>
  s.all ? total : s.selected.size;
