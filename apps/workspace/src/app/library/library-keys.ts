// The library's bindings: the grid's own keys, the item view's way back, and the window's paste.
// `where` is whose listener reads the row: the grid's element, the item view's root, or the window.

import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";

export type LibraryAction =
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "extend-left"
  | "extend-right"
  | "extend-up"
  | "extend-down"
  | "move-first"
  | "move-last"
  | "open-item"
  | "quick-look"
  | "clear-selection"
  | "select-all"
  | "delete-selection"
  | "back-to-library"
  | "save-clipboard";

export type LibraryShortcutWhere = "grid" | "item" | "window";

export interface LibraryShortcut {
  readonly action: LibraryAction;
  // is-hotkey's key name
  readonly key: string;
  readonly mod?: true;
  readonly shift?: true;
  readonly where: LibraryShortcutWhere;
}

/** @internal */
export const LIBRARY_SHORTCUTS: readonly LibraryShortcut[] = [
  { action: "move-left", key: "left", where: "grid" },
  { action: "move-right", key: "right", where: "grid" },
  { action: "move-up", key: "up", where: "grid" },
  { action: "move-down", key: "down", where: "grid" },
  {
    action: "extend-left",
    key: "left",
    shift: true,
    where: "grid",
  },
  {
    action: "extend-right",
    key: "right",
    shift: true,
    where: "grid",
  },
  { action: "extend-up", key: "up", shift: true, where: "grid" },
  {
    action: "extend-down",
    key: "down",
    shift: true,
    where: "grid",
  },
  { action: "move-first", key: "home", where: "grid" },
  { action: "move-last", key: "end", where: "grid" },
  { action: "open-item", key: "enter", where: "grid" },
  { action: "quick-look", key: "space", where: "grid" },
  { action: "clear-selection", key: "escape", where: "grid" },
  { action: "select-all", key: "a", mod: true, where: "grid" },
  { action: "delete-selection", key: "backspace", mod: true, where: "grid" },
  { action: "back-to-library", key: "escape", where: "item" },
  { action: "save-clipboard", key: "v", mod: true, where: "window" },
];

// the DOM's name for each key the table spells
const EVENT_KEYS = new Map([
  ["backspace", "Backspace"],
  ["down", "ArrowDown"],
  ["end", "End"],
  ["enter", "Enter"],
  ["escape", "Escape"],
  ["home", "Home"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["space", " "],
  ["up", "ArrowUp"],
]);

const eventKeyOf = (key: string): string => EVENT_KEYS.get(key) ?? key;

// a key as the grid's, Quick Look's and the item view's listeners hand it over
export interface LibraryKeyEvent extends Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
> {
  readonly nativeEvent: KeyboardEvent;
}

// alt disqualifies outright; a modifier and shift each match only the rows that claim them. A key
// inside an IME composition is the composer's: the Enter that commits a candidate opens nothing
export const libraryShortcutFor = (
  event: LibraryKeyEvent,
  where: LibraryShortcutWhere,
  modifier: ShortcutModifier,
): LibraryShortcut | null => {
  if (event.altKey || isImeComposing(event)) {
    return null;
  }
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (foreign) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    LIBRARY_SHORTCUTS.find(
      (row) =>
        row.where === where &&
        eventKeyOf(row.key) === key &&
        (row.mod === true) === claimed &&
        (row.shift === true) === event.shiftKey,
    ) ?? null
  );
};
