// a key both this table and `packages/editor/src/editor-shortcuts.ts` claim runs both.

import { spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useEffect, useEffectEvent } from "react";

export type GlobalShortcutAction =
  | "open-agent"
  | "open-palette"
  | "open-settings"
  | "toggle-rail"
  | "toggle-panel";

interface ShortcutRow {
  readonly key: string;
  readonly action: GlobalShortcutAction;
}

// the platform's command modifier, which never fires on a shifted chord
interface ModShortcut extends ShortcutRow {
  readonly bare?: never;
}

// one unmodified key, which types a character wherever text is entered, so it answers only
// outside a field
interface BareShortcut extends ShortcutRow {
  readonly bare: true;
}

export type GlobalShortcut = ModShortcut | BareShortcut;

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { action: "open-agent", key: "k" },
  { action: "open-palette", key: "p" },
  { action: "open-settings", key: "," },
  // bare: ⌘[ and ⌘] are the browser's history keys
  { action: "toggle-rail", bare: true, key: "[" },
  { action: "toggle-panel", bare: true, key: "]" },
];

// is-hotkey's spelling, so a global row and an editor row compare as one chord
export const globalShortcutHotkey = (shortcut: GlobalShortcut): string =>
  shortcut.bare === true ? shortcut.key : `mod+${shortcut.key}`;

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

// a field, a text area or the editor: where a bare key types rather than commands
export const isTextEntryTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

// alt disqualifies outright, and shift under the modifier, which no row claims
const globalShortcutFor = (
  event: KeyboardEvent,
  modifier: ShortcutModifier,
): GlobalShortcut | null => {
  if (event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (!event.metaKey && !event.ctrlKey) {
    if (isTextEntryTarget(event.target)) {
      return null;
    }
    return (
      GLOBAL_SHORTCUTS.find((shortcut) => shortcut.bare === true && shortcut.key === key) ?? null
    );
  }
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (!claimed || foreign || event.shiftKey) {
    return null;
  }
  return (
    GLOBAL_SHORTCUTS.find((shortcut) => shortcut.bare !== true && shortcut.key === key) ?? null
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
