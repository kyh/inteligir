// a key both this table and `packages/editor/src/editor-shortcuts.ts` claim runs both.

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
  { key: "k", action: "open-action-composer", label: "Ask the agent" },
  { key: "p", action: "open-palette", label: "Command palette" },
  { key: "o", action: "open-quick-switcher", label: "Open a note" },
  { key: "o", shift: true, action: "open-headings", label: "Go to heading" },
  { key: "f", action: "find-in-note", label: "Find in note" },
  { key: "f", shift: true, action: "open-search", label: "Search across the vault" },
  { key: "d", action: "open-daily-note", label: "Daily note" },
  { key: "\\", action: "toggle-zen", label: "Zen mode" },
  { key: ",", action: "open-settings", label: "Settings" },
];

export type ShortcutModifier = "meta" | "ctrl";

// is-hotkey's spelling, so a global row and an editor row compare as one chord
export function globalShortcutHotkey(shortcut: GlobalShortcut): string {
  return `mod+${shortcut.shift === true ? "shift+" : ""}${shortcut.key}`;
}

// Apple's menu order (⌃⌥⇧⌘) on a mac keyboard; words joined with + elsewhere
export function spellHotkey(hotkey: string, modifier: ShortcutModifier): string {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));
  const keyLabel = key.charAt(0).toUpperCase() + key.slice(1);
  if (modifier === "meta") {
    return `${mods.has("ctrl") ? "⌃" : ""}${mods.has("alt") ? "⌥" : ""}${mods.has("shift") ? "⇧" : ""}${mods.has("mod") ? "⌘" : ""}${keyLabel}`;
  }
  return [
    mods.has("ctrl") || mods.has("mod") ? "Ctrl" : null,
    mods.has("alt") ? "Alt" : null,
    mods.has("shift") ? "Shift" : null,
    keyLabel,
  ]
    .filter((part) => part !== null)
    .join("+");
}

export function bindingFor(
  action: GlobalShortcutAction,
  modifier: ShortcutModifier,
): string | null {
  const row = GLOBAL_SHORTCUTS.find((shortcut) => shortcut.action === action);
  return row === undefined ? null : spellHotkey(globalShortcutHotkey(row), modifier);
}

// never "either": on mac the editor's Ctrl-K is an emacs line kill, and both modifiers would double-fire.
export function platformShortcutModifier(): ShortcutModifier {
  return /mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl";
}

// alt disqualifies outright; shift only matches the row that claims it.
export function globalShortcutFor(
  event: KeyboardEvent,
  modifier: ShortcutModifier,
): GlobalShortcut | null {
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
}

export function useGlobalShortcuts(
  modifier: ShortcutModifier,
  onShortcut: (action: GlobalShortcutAction) => void,
): void {
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
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modifier]);
}
