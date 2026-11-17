// CLAUDE.md § The grid's selection is a store. Finder's grammar: a click selects, ⌘-click toggles,
// ⇧-click extends from the anchor, and an arrow moves the focus and the selection with it. Every
// name is an item's id, which no rename or move changes. The grid reads its listing a page at a
// time, so ⌘A names no id: it selects the scope, read or not, and a ⌘-click from there leaves an
// item out. An id the listing no longer shows selects nothing, so no one prunes it. The store is
// created once by the workspace, so leaving for an item and coming back finds the selection as it
// was left.

import type { ItemKind } from "@repo/contract/items/item-kind";
import type { sweptSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { z } from "zod";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

export type Selected =
  | { readonly kind: "ids"; readonly ids: ReadonlySet<string> }
  // every item the grid's scope lists but these
  | { readonly kind: "scope"; readonly except: ReadonlySet<string> };

export interface LibrarySelection {
  selected: Selected;
  anchor: string | null;
  focus: string | null;
}

export const isSelected = (selected: Selected, id: string): boolean =>
  selected.kind === "ids" ? selected.ids.has(id) : !selected.except.has(id);

// a listing as far as the grid read it: its rows so far, and how many it lists
interface Listing<R> {
  readonly items: readonly R[];
  readonly total: number;
}

// the selection over a listing: its rows read so far, and how many it names, read or not
export const selectedIn = <R extends { readonly id: string }>(
  selected: Selected,
  listing: Listing<R>,
) => {
  const rows = listing.items.filter((row) => isSelected(selected, row.id));
  return {
    count:
      selected.kind === "ids"
        ? rows.length
        : Math.max(rows.length, listing.total - selected.except.size),
    rows,
  };
};

type Swept = z.input<typeof sweptSchema>;

// What a verb takes of a selection: its items by id while the grid read every one of them, else
// the scope less those left out, which only the cell can name (`library.items.sweep`)
export type Target =
  | { readonly kind: "ids"; readonly ids: readonly string[] }
  | { readonly kind: "scope"; readonly count: number; readonly swept: Swept };

export const targetCount = (target: Target): number =>
  target.kind === "ids" ? target.ids.length : target.count;

export const targetOf = (
  selected: Selected,
  listing: Listing<{ readonly id: string }>,
  shown: { readonly scope: LibraryScope; readonly kind: ItemKind | null },
): Target => {
  const { count, rows } = selectedIn(selected, listing);
  if (selected.kind === "ids" || count === rows.length) {
    return { ids: rows.map((row) => row.id), kind: "ids" };
  }
  const swept: Swept = { except: [...selected.except], scope: shown.scope };
  if (shown.kind !== null) {
    swept.kinds = [shown.kind];
  }
  return { count, kind: "scope", swept };
};

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
  | { kind: "all" }
  | { kind: "clear" };

const ids = (named: Iterable<string>): Selected => ({ ids: new Set(named), kind: "ids" });

const EMPTY_SELECTION: LibrarySelection = { anchor: null, focus: null, selected: ids([]) };

// the ids between two in the grid's order, both ends included; one alone when either is absent
const spanOf = (order: readonly string[], from: string, to: string): Selected => {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) {
    return ids([to]);
  }
  return ids(order.slice(Math.min(a, b), Math.max(a, b) + 1));
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
      return { anchor: g.id, focus: g.id, selected: ids([g.id]) };
    }
    case "toggle": {
      // in a scope's selection the names are those left out
      const named = new Set(s.selected.kind === "ids" ? s.selected.ids : s.selected.except);
      if (!named.delete(g.id)) {
        named.add(g.id);
      }
      return {
        anchor: g.id,
        focus: g.id,
        selected: s.selected.kind === "ids" ? ids(named) : { except: named, kind: "scope" },
      };
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
      return { anchor: focus, focus, selected: ids([focus]) };
    }
    case "all": {
      return { ...s, selected: { except: new Set(), kind: "scope" } };
    }
    case "clear": {
      return EMPTY_SELECTION;
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
