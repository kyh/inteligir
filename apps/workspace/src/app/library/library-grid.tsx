// CLAUDE.md § THE GRID'S SELECTION IS A STORE, A CLICK SELECTS AND A DOUBLE-CLICK OPENS. The
// listing as cards: `count` is the listing's total and only the windows in view are loaded, so a
// cell outside them draws a skeleton. The grid owns the gestures (the selection, the focus, the
// keys of LIBRARY_SHORTCUTS' grid rows, the drag and the menu); what a verb does is the caller's.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { CardGrid } from "@repo/ui/components/card-grid";
import type { CardGridHandle } from "@repo/ui/components/card-grid";
import { MediaCardSkeleton, mediaCardHeight } from "@repo/ui/components/media-card";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import { useMediaOrigin } from "../vault-hooks";
import { useNow } from "../relative-time";
import { endInternalDrag, internalDrag, startInternalDrag } from "./drag-store";
import { ItemCard } from "./item-card";
import { isUrlItem } from "./item-labels";
import { ItemMenu } from "./item-menu";
import type { ItemMenuState, LibraryItemActions } from "./item-menu";
import { libraryShortcutFor } from "./library-keys";
import type { LibraryAction } from "./library-keys";
import {
  LIBRARY_WINDOW,
  materializePaths,
  rowAt,
  useLibraryWindows,
  windowsAround,
} from "./library-items";
import type { LibraryFilter } from "./library-items";
import type { LibrarySelectionStore, MoveDelta } from "./library-selection";
import { QuickLook } from "./quick-look";
import { KNOWLEDGE_ITEM_PATHS_MAX } from "@repo/contract/local/knowledge/knowledge-schema";

const MIN_CELL_WIDTH = 200;

const MOVES: Partial<Record<LibraryAction, { delta: MoveDelta; extend: boolean }>> = {
  "extend-down": { delta: "down", extend: true },
  "extend-left": { delta: "left", extend: true },
  "extend-right": { delta: "right", extend: true },
  "extend-up": { delta: "up", extend: true },
  "move-down": { delta: "down", extend: false },
  "move-left": { delta: "left", extend: false },
  "move-right": { delta: "right", extend: false },
  "move-up": { delta: "up", extend: false },
};

export interface LibraryGridProps {
  filter: LibraryFilter;
  total: number;
  selection: LibrarySelectionStore;
  // where the grid was scrolled to, read once as it mounts and written as it scrolls
  scrollMemory: StoreApi<number>;
  actions: LibraryItemActions;
}

interface Loaded {
  rows: readonly ItemRowWire[];
  // grid order, the loaded rows alone
  order: readonly string[];
  indexOf: ReadonlyMap<string, number>;
}

// a path's place in the listing, kept from the last time its window was loaded: the focused
// card and the selection's anchor stay findable once the grid scrolls far from them
interface Pin {
  path: string;
  index: number;
}

const pinOf = (
  path: string | null,
  indexOf: ReadonlyMap<string, number>,
  kept: Pin | null,
): Pin | null => {
  if (path === null) {
    return null;
  }
  const index = indexOf.get(path);
  if (index !== undefined) {
    return { index, path };
  }
  return kept?.path === path ? kept : null;
};

const loadedRows = (windows: ReadonlyMap<number, { items: readonly ItemRowWire[] }>): Loaded => {
  const rows: ItemRowWire[] = [];
  const indexOf = new Map<string, number>();
  for (const windowIndex of [...windows.keys()].toSorted((a, b) => a - b)) {
    const items = windows.get(windowIndex)?.items ?? [];
    for (const [at, row] of items.entries()) {
      rows.push(row);
      indexOf.set(row.path, windowIndex * LIBRARY_WINDOW + at);
    }
  }
  return { indexOf, order: rows.map((row) => row.path), rows };
};

export const LibraryGrid = ({
  filter,
  total,
  selection,
  scrollMemory,
  actions,
}: LibraryGridProps) => {
  // oxlint-disable-next-line react/hook-use-state -- read once as the grid mounts: the scroll it restores
  const [initialOffset] = useState(() => scrollMemory.getState());
  const [range, setRange] = useState({ first: 0, last: LIBRARY_WINDOW - 1 });
  const [columns, setColumns] = useState(1);
  const [menu, setMenu] = useState<ItemMenuState | null>(null);
  const [lookAt, setLookAt] = useState<string | null>(null);
  const gridRef = useRef<CardGridHandle | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const state = useStore(selection.store);
  const [pins, setPins] = useState<{ focus: Pin | null; anchor: Pin | null }>({
    anchor: null,
    focus: null,
  });
  // the card the keyboard lands on once it renders: the focused one as the grid comes back from
  // an item, or the one End or an arrow moved to while its window was still loading. The card
  // takes the focus itself as it mounts, and the next gesture lets the wish go
  const [wantFocus, setWantFocus] = useState<string | null>(() => selection.store.getState().focus);
  const focusPin = pins.focus !== null && pins.focus.path === state.focus ? pins.focus : null;
  // the focused card's window stays loaded wherever the grid scrolls, so its card stays mounted
  // and the keys keep working
  const focusWindow = focusPin === null ? null : Math.floor(focusPin.index / LIBRARY_WINDOW);
  const around = windowsAround(range, total);
  const windows = useLibraryWindows(
    filter,
    focusWindow === null || around.includes(focusWindow) ? around : [...around, focusWindow],
  );
  const loaded = loadedRows(windows);
  const media = useMediaOrigin();
  const now = useNow();
  const focusIndex =
    state.focus === null ? null : (loaded.indexOf.get(state.focus) ?? focusPin?.index ?? null);

  // where the selection's focus and anchor sit in the listing, read after a gesture moved them
  const pinSelection = (): void => {
    const { anchor, focus } = selection.store.getState();
    setWantFocus(null);
    setPins((held) => ({
      anchor: pinOf(anchor, loaded.indexOf, held.anchor),
      focus: pinOf(focus, loaded.indexOf, held.focus),
    }));
  };

  const isSelected = (path: string): boolean => state.all || state.selected.has(path);

  // the names a ⌘A stood for, read before a gesture that edits them
  const settleAll = async (): Promise<void> => {
    if (!selection.store.getState().all) {
      return;
    }
    const paths = await materializePaths(filter, 0, KNOWLEDGE_ITEM_PATHS_MAX);
    selection.apply({ kind: "materialize", paths });
  };

  // the card scrolled to and focused once it renders, however long its window takes
  const focusCard = (path: string, index: number | null): void => {
    if (index !== null) {
      gridRef.current?.scrollToCell(index);
      setPins((held) => ({ ...held, focus: { index, path } }));
    }
    setWantFocus(path);
  };

  // every row from the anchor to `path`, read from the listing when the loaded windows do not
  // hold them all, so a ⇧-click far from the anchor selects the whole span
  const rangeTo = async (path: string): Promise<void> => {
    const { anchor } = selection.store.getState();
    const anchorIndex =
      anchor === null
        ? null
        : (loaded.indexOf.get(anchor) ?? (pins.anchor?.path === anchor ? pins.anchor.index : null));
    const toIndex = loaded.indexOf.get(path);
    if (anchorIndex === null || toIndex === undefined) {
      selection.apply({ kind: "range", order: loaded.order, path });
      return;
    }
    const from = Math.min(anchorIndex, toIndex);
    const to = Math.max(anchorIndex, toIndex);
    const spanned = Array.from(
      { length: Math.floor(to / LIBRARY_WINDOW) - Math.floor(from / LIBRARY_WINDOW) + 1 },
      (_, at) => Math.floor(from / LIBRARY_WINDOW) + at,
    );
    const order = spanned.every((windowIndex) => windows.has(windowIndex))
      ? loaded.order
      : await materializePaths(filter, from, to + 1);
    selection.apply({ kind: "range", order, path });
  };

  const press = (row: ItemRowWire, event: MouseEvent<HTMLDivElement>): void => {
    const toggle = platformShortcutModifier() === "meta" ? event.metaKey : event.ctrlKey;
    if (event.shiftKey || toggle) {
      void (async () => {
        await settleAll();
        if (event.shiftKey) {
          await rangeTo(row.path);
        } else {
          selection.apply({ kind: "toggle", path: row.path });
        }
        pinSelection();
      })();
      return;
    }
    selection.apply({ kind: "click", path: row.path });
    pinSelection();
  };

  // under ⌘A the card is one of everything selected, so the menu acts on the whole selection
  const openMenu = (row: ItemRowWire, anchor: HTMLElement): void => {
    void (async () => {
      await settleAll();
      const current = selection.store.getState();
      const inSelection = current.selected.has(row.path);
      if (!inSelection) {
        selection.apply({ kind: "click", path: row.path });
        pinSelection();
      }
      const subjects =
        inSelection && current.selected.size > 1 ? [...current.selected] : [row.path];
      setMenu({ anchor, row, subjects });
    })();
  };

  const dragStart = (row: ItemRowWire, event: DragEvent<HTMLDivElement>): void => {
    const current = selection.store.getState();
    // under ⌘A the drag carries everything: the loaded rows at once, every name once the listing
    // answers, which a drop reads well after the drag began
    if (current.all) {
      startInternalDrag(loaded.order);
      void (async () => {
        await settleAll();
        if (internalDrag() !== null) {
          startInternalDrag([...selection.store.getState().selected]);
        }
      })();
    }
    const paths =
      !current.all && current.selected.has(row.path) ? [...current.selected] : [row.path];
    if (!current.all && !current.selected.has(row.path)) {
      selection.apply({ kind: "click", path: row.path });
      pinSelection();
    }
    if (!current.all) {
      startInternalDrag(paths);
    }
    event.dataTransfer.effectAllowed = "copyMove";
    const urls = (current.all ? loaded.order : paths)
      .map((path) => (path === row.path ? row : loaded.rows.find((other) => other.path === path)))
      .filter((other): other is ItemRowWire => other !== undefined && isUrlItem(other))
      .map((other) => other.url)
      .filter((url): url is string => url !== null);
    if (urls.length > 0) {
      event.dataTransfer.setData("text/uri-list", urls.join("\r\n"));
    }
    event.dataTransfer.setData("text/plain", urls.length > 0 ? urls.join("\n") : row.title);
  };

  const stepLook = (path: string, by: -1 | 1): void => {
    const at = loaded.order.indexOf(path);
    const next = loaded.order[at + by];
    if (at !== -1 && next !== undefined) {
      setLookAt(next);
      selection.apply({ kind: "click", path: next });
      pinSelection();
    }
  };

  const goToEnd = (which: "first" | "last"): void => {
    const index = which === "first" ? 0 : Math.max(0, total - 1);
    gridRef.current?.scrollToCell(index);
    void (async () => {
      const [path] = await materializePaths(filter, index, index + 1);
      if (path !== undefined) {
        selection.apply({ kind: "click", path });
        setPins({ anchor: { index, path }, focus: { index, path } });
        focusCard(path, index);
      }
    })();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const shortcut = libraryShortcutFor(event, "grid", platformShortcutModifier());
    if (shortcut === null || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    const { action } = shortcut;
    const move = MOVES[action];
    if (move !== undefined) {
      void (async () => {
        if (move.extend) {
          await settleAll();
        }
        selection.apply({ ...move, columns, kind: "move", order: loaded.order });
        pinSelection();
        const { focus } = selection.store.getState();
        if (focus !== null) {
          focusCard(focus, loaded.indexOf.get(focus) ?? null);
        }
      })();
      return;
    }
    const { focus } = selection.store.getState();
    switch (action) {
      case "move-first":
      case "move-last": {
        goToEnd(action === "move-first" ? "first" : "last");
        break;
      }
      case "open-item": {
        if (focus !== null) {
          actions.open(focus);
        }
        break;
      }
      case "quick-look": {
        if (focus !== null) {
          setLookAt(focus);
        }
        break;
      }
      case "clear-selection": {
        selection.apply({ kind: "clear" });
        break;
      }
      case "select-all": {
        selection.apply({ kind: "all" });
        break;
      }
      case "delete-selection": {
        void (async () => {
          await settleAll();
          const paths = [...selection.store.getState().selected];
          if (paths.length > 0) {
            actions.remove(paths);
          }
        })();
        break;
      }
      default: {
        break;
      }
    }
  };

  // the focused card while it is rendered, else the first card in view: a tab stop on a card that
  // is not drawn would leave Tab no way back into the grid
  const tabStop =
    state.focus !== null && loaded.indexOf.has(state.focus)
      ? state.focus
      : (rowAt(windows, range.first)?.path ?? null);

  return (
    <div ref={shellRef} className="flex min-h-0 flex-1 flex-col" data-library-grid="">
      <CardGrid
        aria-label="Library"
        aria-multiselectable
        count={total}
        minCellWidth={MIN_CELL_WIDTH}
        cellHeight={mediaCardHeight}
        initialOffset={initialOffset}
        onScrollOffset={(px) => {
          scrollMemory.setState(px, true);
        }}
        onRangeChange={setRange}
        onColumnsChange={setColumns}
        keepMountedIndex={focusIndex}
        handleRef={gridRef}
        onKeyDown={onKeyDown}
        renderCell={(index) => {
          const row = rowAt(windows, index);
          if (row === null) {
            return <MediaCardSkeleton />;
          }
          return (
            <ItemCard
              row={row}
              selected={isSelected(row.path)}
              tabStop={row.path === tabStop}
              takeFocus={row.path === wantFocus}
              media={media}
              nowMs={now}
              onPress={press}
              onOpen={(target) => {
                actions.open(target.path);
              }}
              onMenu={openMenu}
              onDragStart={dragStart}
              onDragEnd={endInternalDrag}
            />
          );
        }}
      />
      <ItemMenu
        menu={menu}
        onClose={() => {
          setMenu(null);
        }}
        actions={{
          ...actions,
          quickLook: setLookAt,
        }}
      />
      <QuickLook
        path={lookAt}
        onClose={() => {
          setLookAt(null);
        }}
        onOpen={(path) => {
          setLookAt(null);
          actions.open(path);
        }}
        onStep={stepLook}
      />
    </div>
  );
};
