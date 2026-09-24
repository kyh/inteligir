// a key both this table and `packages/editor/src/editor-shortcuts.ts` claim runs both.

import { hotkeyCaps, spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useEffect, useEffectEvent } from "react";

export type GlobalShortcutAction =
  | "open-action-composer"
  | "open-palette"
  | "find-in-note"
  | "open-headings"
  | "open-settings"
  | "open-daily-note"
  | "toggle-zen"
  | "toggle-rail"
  | "toggle-panel";

interface ShortcutRow {
  readonly key: string;
  readonly action: GlobalShortcutAction;
  readonly label: string;
}

// the platform's command modifier; a row claims shift explicitly, so an unshifted row never
// fires on a shifted chord
interface ModShortcut extends ShortcutRow {
  readonly bare?: never;
  readonly shift?: true;
}

// one unmodified key, which types a character wherever text is entered, so it answers only
// outside a field
interface BareShortcut extends ShortcutRow {
  readonly bare: true;
  readonly shift?: never;
}

export type GlobalShortcut = ModShortcut | BareShortcut;

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { action: "open-action-composer", key: "k", label: "Ask the agent" },
  { action: "open-palette", key: "p", label: "Command palette" },
  { action: "open-headings", key: "o", label: "Go to heading", shift: true },
  { action: "find-in-note", key: "f", label: "Find in note" },
  { action: "open-daily-note", key: "d", label: "Daily note" },
  { action: "toggle-zen", key: "\\", label: "Zen mode" },
  { action: "open-settings", key: ",", label: "Settings" },
  // bare: ⌘[ and ⌘] are the browser's history keys
  { action: "toggle-rail", bare: true, key: "[", label: "Toggle sidebar" },
  { action: "toggle-panel", bare: true, key: "]", label: "Toggle panel" },
];

// is-hotkey's spelling, so a global row and an editor row compare as one chord
export const globalShortcutHotkey = (shortcut: GlobalShortcut): string =>
  shortcut.bare === true
    ? shortcut.key
    : `mod+${shortcut.shift === true ? "shift+" : ""}${shortcut.key}`;

const hotkeyFor = (action: GlobalShortcutAction): string | null => {
  const row = GLOBAL_SHORTCUTS.find((shortcut) => shortcut.action === action);
  return row === undefined ? null : globalShortcutHotkey(row);
};

export const bindingFor = (
  action: GlobalShortcutAction,
  modifier: ShortcutModifier,
): string | null => {
  const hotkey = hotkeyFor(action);
  return hotkey === null ? null : spellHotkey(hotkey, modifier);
};

export const bindingCapsFor = (
  action: GlobalShortcutAction,
  modifier: ShortcutModifier,
): readonly string[] => {
  const hotkey = hotkeyFor(action);
  return hotkey === null ? [] : hotkeyCaps(hotkey, modifier);
};

const takesText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

// alt disqualifies outright; shift only matches the row that claims it.
export const globalShortcutFor = (
  event: KeyboardEvent,
  modifier: ShortcutModifier,
): GlobalShortcut | null => {
  if (event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (!event.metaKey && !event.ctrlKey) {
    if (takesText(event.target)) {
      return null;
    }
    return (
      GLOBAL_SHORTCUTS.find((shortcut) => shortcut.bare === true && shortcut.key === key) ?? null
    );
  }
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (!claimed || foreign) {
    return null;
  }
  return (
    GLOBAL_SHORTCUTS.find(
      (shortcut) =>
        shortcut.bare !== true &&
        shortcut.key === key &&
        (shortcut.shift === true) === event.shiftKey,
    ) ?? null
  );
};

interface GlobalShortcutOptions {
  modifier: ShortcutModifier;
  // off, the listener is detached: a chord the table claims reaches the page, or the browser
  enabled: boolean;
}

export const useGlobalShortcuts = (
  { modifier, enabled }: GlobalShortcutOptions,
  onShortcut: (action: GlobalShortcutAction) => void,
): void => {
  const onAction = useEffectEvent(onShortcut);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcut = globalShortcutFor(event, modifier);
      if (shortcut === null) {
        return;
      }
      event.preventDefault();
      onAction(shortcut.action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modifier, enabled]);
};
