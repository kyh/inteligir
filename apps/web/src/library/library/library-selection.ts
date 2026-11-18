import type { ItemKind } from "@repo/contract/items/item-kind";
import type { sweptSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { z } from "zod";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

export type Selected =
  | { readonly kind: "ids"; readonly ids: ReadonlySet<string> }
  | { readonly kind: "scope"; readonly except: ReadonlySet<string> };

export interface LibrarySelection {
  selected: Selected;
  anchor: string | null;
  focus: string | null;
}

export const isSelected = (selected: Selected, id: string) =>
  selected.kind === "ids" ? selected.ids.has(id) : !selected.except.has(id);

interface Listing<R> {
  readonly items: readonly R[];
  readonly total: number;
}

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

export type Target =
  | { readonly kind: "ids"; readonly ids: readonly string[] }
  | { readonly kind: "scope"; readonly count: number; readonly swept: Swept };

export const targetCount = (target: Target) =>
  target.kind === "ids" ? target.ids.length : target.count;

export interface Shown {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
}

export const targetOf = (
  selected: Selected,
  listing: Listing<{ readonly id: string }>,
  shown: Shown | null,
) => {
  if (shown === null) {
    return null;
  }

  const { count, rows } = selectedIn(selected, listing);

  if (selected.kind === "ids" || count === rows.length) {
    return { ids: rows.map((row) => row.id), kind: "ids" } satisfies Target | null;
  }

  const swept: Swept = { except: [...selected.except], scope: shown.scope };

  if (shown.kind !== null) {
    swept.kinds = [shown.kind];
  }

  return { count, kind: "scope", swept } satisfies Target | null;
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

const ids = (named: Iterable<string>) => ({ ids: new Set(named), kind: "ids" }) satisfies Selected;

const EMPTY_SELECTION: LibrarySelection = { anchor: null, focus: null, selected: ids([]) };

const spanOf = (order: readonly string[], from: string, to: string) => {
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
) => {
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

  return next < 0 || next >= order.length ? (order[at] ?? null) : (order[next] ?? null);
};

export const selectionAfter = (s: LibrarySelection, g: SelectionGesture) => {
  switch (g.kind) {
    case "click": {
      return { anchor: g.id, focus: g.id, selected: ids([g.id]) } satisfies LibrarySelection;
    }

    case "toggle": {
      const named = new Set(s.selected.kind === "ids" ? s.selected.ids : s.selected.except);

      if (!named.delete(g.id)) {
        named.add(g.id);
      }

      return {
        anchor: g.id,
        focus: g.id,
        selected: s.selected.kind === "ids" ? ids(named) : { except: named, kind: "scope" },
      } satisfies LibrarySelection;
    }

    case "range": {
      const anchor = s.anchor ?? g.id;

      return {
        anchor,
        focus: g.id,
        selected: spanOf(g.order, anchor, g.id),
      } satisfies LibrarySelection;
    }

    case "move": {
      const focus = stepped(g.order, s.focus, g.delta, Math.max(1, g.columns));

      if (focus === null) {
        return s;
      }

      if (g.extend) {
        const anchor = s.anchor ?? s.focus ?? focus;

        return {
          anchor,
          focus,
          selected: spanOf(g.order, anchor, focus),
        } satisfies LibrarySelection;
      }

      return { anchor: focus, focus, selected: ids([focus]) } satisfies LibrarySelection;
    }

    case "all": {
      return { ...s, selected: { except: new Set(), kind: "scope" } } satisfies LibrarySelection;
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

export const createLibrarySelection = () => {
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
  } satisfies LibrarySelectionStore;
};
