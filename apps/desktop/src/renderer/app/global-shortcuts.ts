// a key both this table and `packages/editor/src/editor-shortcuts.ts` claim runs both.

import { spellHotkey } from "@repo/editor/hotkey-spelling";
import type { ShortcutModifier } from "@repo/editor/hotkey-spelling";
import { useEffect, useLayoutEffect, useRef } from "react";

export type GlobalShortcutAction =
  | "open-action-composer"
  | "open-palette"
  | "find-in-note"
  | "open-search"
  | "open-quick-switcher"
  | "open-headings"
  | "open-settings"
  | "open-daily-note"
  | "toggle-zen";

export interface GlobalShortcut {
  readonly key: string;
  // a row claims shift explicitly; an unshifted row never fires shifted, so ⌘⇧K stays the editor's link insert
  readonly shift?: true;
  readonly action: GlobalShortcutAction;
  readonly label: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { action: "open-action-composer", key: "k", label: "Ask the agent" },
  { action: "open-palette", key: "p", label: "Command palette" },
  { action: "open-quick-switcher", key: "o", label: "Open a note" },
  { action: "open-headings", key: "o", label: "Go to heading", shift: true },
  { action: "find-in-note", key: "f", label: "Find in note" },
  { action: "open-search", key: "f", label: "Search across the vault", shift: true },
  { action: "open-daily-note", key: "d", label: "Daily note" },
  { action: "toggle-zen", key: "\\", label: "Zen mode" },
  { action: "open-settings", key: ",", label: "Settings" },
];

// is-hotkey's spelling, so a global row and an editor row compare as one chord
export const globalShortcutHotkey = (shortcut: GlobalShortcut): string =>
  `mod+${shortcut.shift === true ? "shift+" : ""}${shortcut.key}`;

export const bindingFor = (
  action: GlobalShortcutAction,
  modifier: ShortcutModifier,
): string | null => {
  const row = GLOBAL_SHORTCUTS.find((shortcut) => shortcut.action === action);
  return row === undefined ? null : spellHotkey(globalShortcutHotkey(row), modifier);
};

// alt disqualifies outright; shift only matches the row that claims it.
export const globalShortcutFor = (
  event: KeyboardEvent,
  modifier: ShortcutModifier,
): GlobalShortcut | null => {
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (!claimed || foreign || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  return (
    GLOBAL_SHORTCUTS.find(
      (shortcut) => shortcut.key === key && (shortcut.shift === true) === event.shiftKey,
    ) ?? null
  );
};

export const useGlobalShortcuts = (
  modifier: ShortcutModifier,
  onShortcut: (action: GlobalShortcutAction) => void,
): void => {
  const latest = useRef(onShortcut);
  useLayoutEffect(() => {
    latest.current = onShortcut;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcut = globalShortcutFor(event, modifier);
      if (shortcut === null) {
        return;
      }
      event.preventDefault();
      latest.current(shortcut.action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modifier]);
};
