// CLAUDE.md § The grid's selection is a store. Finder's grammar: a click selects, ⌘-click toggles,
// ⇧-click extends from the anchor, and an arrow moves the focus and the selection with it. Every
// name is an item's id, which no rename or move changes, and the listing is in memory, so ⌘A names
// the scope's every id at once. The store is created once by the workspace, so leaving for an item
// and coming back finds the selection as it was left.

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

export interface LibrarySelection {
  selected: ReadonlySet<string>;
  anchor: string | null;
  focus: string | null;
}

export type MoveDelta = "left" | "right" | "up" | "down" | "first" | "last";

export type SelectionGesture =
  | { kind: "click"; id: string }
  | { kind: "toggle"; id: string }
  | { kind: "range"; id: string; order: readonly string[] }
  | {
      kind: "move";
      delta: MoveDelta;
      extend: boolean;
      order: readonly string[];
      columns: number;
    }
  | { kind: "all"; order: readonly string[] }
  | { kind: "clear" }
  // items no longer in the listing: deleted, restored or moved out of the scope
  | { kind: "prune"; gone: ReadonlySet<string> };

const EMPTY_SELECTION: LibrarySelection = {
  anchor: null,
  focus: null,
  selected: new Set(),
};

// the ids between two in the grid's order, both ends included; one alone when either is absent
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
      return { anchor: g.id, focus: g.id, selected: new Set([g.id]) };
    }
    case "toggle": {
      const selected = new Set(s.selected);
      if (selected.has(g.id)) {
        selected.delete(g.id);
      } else {
        selected.add(g.id);
      }
      return { anchor: g.id, focus: g.id, selected };
    }
    case "range": {
      const anchor = s.anchor ?? g.id;
      return { anchor, focus: g.id, selected: spanOf(g.order, anchor, g.id) };
    }
    case "move": {
      const focus = stepped(g.order, s.focus, g.delta, Math.max(1, g.columns));
      if (focus === null) {
        return s;
      }
      if (g.extend) {
        const anchor = s.anchor ?? s.focus ?? focus;
        return { anchor, focus, selected: spanOf(g.order, anchor, focus) };
      }
      return { anchor: focus, focus, selected: new Set([focus]) };
    }
    case "all": {
      return { ...s, selected: new Set(g.order) };
    }
    case "clear": {
      return EMPTY_SELECTION;
    }
    case "prune": {
      if (![...s.selected].some((id) => g.gone.has(id)) && !g.gone.has(s.focus ?? "")) {
        return s;
      }
      const keep = (id: string | null): string | null =>
        id !== null && g.gone.has(id) ? null : id;
      return {
        anchor: keep(s.anchor),
        focus: keep(s.focus),
        selected: new Set([...s.selected].filter((id) => !g.gone.has(id))),
      };
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
