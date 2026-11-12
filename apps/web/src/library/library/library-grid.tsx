// CLAUDE.md § The grid's selection is a store, a click selects and a double-click opens. The
// listing as cards: the pages the cell answered so far, only the cards in view drawn, and the next
// page asked for as the view nears the end of what is read. The grid
// owns the gestures (the selection, the focus, the keys of the shortcut table's grid rows and the
// menu); what a verb does is the caller's.

import { CardGrid } from "@repo/ui/components/card-grid";
import type { CardGridHandle } from "@repo/ui/components/card-grid";
import { mediaCardHeight } from "@repo/ui/components/media-card";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useStore } from "zustand";

import { useNow } from "../relative-time";
import { ItemCard } from "./item-card";
import { ItemMenu } from "./item-menu";
import type { ItemMenuState, LibraryGridActions } from "./item-menu";
import { shortcutFor } from "../shortcuts";
import type { ShortcutIn } from "../shortcuts";
import type { LibrarySelectionStore, MoveDelta } from "./library-selection";
import { QuickLook } from "./quick-look";
import type { ListedItem } from "./listing";

const MIN_CELL_WIDTH = 200;

const MOVES: Partial<Record<ShortcutIn<"grid">["action"], { delta: MoveDelta; extend: boolean }>> =
  {
    "extend-down": { delta: "down", extend: true },
    "extend-left": { delta: "left", extend: true },
    "extend-right": { delta: "right", extend: true },
    "extend-up": { delta: "up", extend: true },
    "move-down": { delta: "down", extend: false },
    "move-first": { delta: "first", extend: false },
    "move-last": { delta: "last", extend: false },
    "move-left": { delta: "left", extend: false },
    "move-right": { delta: "right", extend: false },
    "move-up": { delta: "up", extend: false },
  };

// how many rows short of the end of what is read the next page is asked for
const NEAR_END_ROWS = 60;

export interface LibraryGridProps {
  readonly rows: readonly ListedItem[];
  readonly selection: LibrarySelectionStore;
  readonly actions: LibraryGridActions;
  // the view came near the end of the rows read so far
  readonly onNearEnd: () => void;
}

export const LibraryGrid = ({ rows, selection, actions, onNearEnd }: LibraryGridProps) => {
  const [columns, setColumns] = useState(1);
  const [menu, setMenu] = useState<ItemMenuState | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const gridRef = useRef<CardGridHandle | null>(null);
  const state = useStore(selection.store);
  const nowMs = useNow();
  const order = rows.map((row) => row.id);
  const focusIndex = state.focus === null ? -1 : order.indexOf(state.focus);
  const modifier = platformShortcutModifier();

  const selectedRows = (): ListedItem[] => rows.filter((row) => state.selected.has(row.id));

  const press = (row: ListedItem, event: MouseEvent<HTMLDivElement>): void => {
    const toggling = modifier === "meta" ? event.metaKey : event.ctrlKey;
    if (event.shiftKey) {
      selection.apply({ id: row.id, kind: "range", order });
    } else if (toggling) {
      selection.apply({ id: row.id, kind: "toggle" });
    } else if (event.detail !== 2) {
      selection.apply({ id: row.id, kind: "click" });
    }
  };

  const openMenu = (row: ListedItem, anchor: HTMLElement): void => {
    const inSelection = state.selected.has(row.id);
    if (!inSelection) {
      selection.apply({ id: row.id, kind: "click" });
    }
    setMenu({ anchor, row, subjects: inSelection ? selectedRows() : [row] });
  };

  const focusCard = (id: string): void => {
    const index = order.indexOf(id);
    if (index !== -1) {
      gridRef.current?.scrollToCell(index);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-item-id="${id}"]`)
          ?.focus({ preventScroll: true });
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const shortcut = shortcutFor(event.nativeEvent, "grid", modifier);
    if (shortcut === null) {
      return;
    }
    const move = MOVES[shortcut.action];
    if (move !== undefined) {
      event.preventDefault();
      selection.apply({ columns, delta: move.delta, extend: move.extend, kind: "move", order });
      const { focus } = selection.store.getState();
      if (focus !== null) {
        focusCard(focus);
      }
      return;
    }
    const focused = rows[focusIndex] ?? null;
    switch (shortcut.action) {
      case "open-item": {
        if (focused !== null) {
          event.preventDefault();
          actions.open(focused);
        }
        return;
      }
      case "quick-look": {
        if (focused !== null) {
          event.preventDefault();
          setLook(focused.id);
        }
        return;
      }
      case "clear-selection": {
        selection.apply({ kind: "clear" });
        return;
      }
      case "select-all": {
        event.preventDefault();
        selection.apply({ kind: "all", order });
        return;
      }
      case "delete-selection": {
        const subjects = selectedRows();
        if (subjects.length > 0) {
          event.preventDefault();
          if (subjects.every((row) => row.fields.deletedAt === null)) {
            actions.remove(subjects);
          }
        }
        break;
      }
      default: {
        break;
      }
    }
  };

  const lookRow = look === null ? null : (rows.find((row) => row.id === look) ?? null);

  return (
    <div className="relative min-h-0 flex-1">
      <CardGrid
        aria-label="Library"
        aria-multiselectable
        className="h-full"
        count={rows.length}
        minCellWidth={MIN_CELL_WIDTH}
        cellHeight={mediaCardHeight}
        handleRef={gridRef}
        keepMountedIndex={focusIndex === -1 ? null : focusIndex}
        onColumnsChange={setColumns}
        onKeyDown={onKeyDown}
        onRangeChange={({ last }) => {
          if (last >= rows.length - NEAR_END_ROWS) {
            onNearEnd();
          }
        }}
        renderCell={(index) => {
          const row = rows[index];
          if (row === undefined) {
            return null;
          }
          return (
            <ItemCard
              row={row}
              selected={state.selected.has(row.id)}
              tabStop={focusIndex === -1 ? index === 0 : index === focusIndex}
              nowMs={nowMs}
              onPress={press}
              onOpen={(opened) => {
                actions.open(opened);
              }}
              onMenu={openMenu}
            />
          );
        }}
      />
      <ItemMenu
        menu={menu}
        actions={{
          ...actions,
          quickLook: (row) => {
            setLook(row.id);
          },
        }}
        onClose={() => {
          setMenu(null);
        }}
      />
      <QuickLook
        row={lookRow}
        onClose={() => {
          const from = look;
          setLook(null);
          if (from !== null) {
            focusCard(from);
          }
        }}
        onOpen={(row) => {
          setLook(null);
          actions.open(row);
        }}
        onStep={(by) => {
          const at = look === null ? -1 : order.indexOf(look);
          const next = rows[at + by];
          if (next !== undefined) {
            setLook(next.id);
            selection.apply({ id: next.id, kind: "click" });
          }
        }}
      />
    </div>
  );
};
