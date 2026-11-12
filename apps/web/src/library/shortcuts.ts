// The tab's bindings, one table for every listener. `scope` is whose listener reads a row: the
// window's, its paste catcher's, the grid's element or the item view's root. A key both this table
// and `packages/editor/src/editor-shortcuts.ts` claim runs both.

import { spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { useEffect, useEffectEvent } from "react";

interface Row<Scope extends string, Action extends string> {
  readonly scope: Scope;
  readonly action: Action;
  // is-hotkey's key name
  readonly key: string;
  // the platform's command modifier
  readonly mod?: true;
  readonly shift?: true;
}

type Shortcut =
  | Row<"window", "open-agent" | "open-palette" | "open-settings" | "toggle-rail" | "toggle-panel">
  | Row<"paste", "save-clipboard">
  | Row<
      "grid",
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
    >
  | Row<"item", "back-to-library">;

type ShortcutScope = Shortcut["scope"];

export type ShortcutIn<Scope extends ShortcutScope> = Extract<Shortcut, { scope: Scope }>;

const SHORTCUTS: readonly Shortcut[] = [
  { action: "open-agent", key: "k", mod: true, scope: "window" },
  { action: "open-palette", key: "p", mod: true, scope: "window" },
  { action: "open-settings", key: ",", mod: true, scope: "window" },
  // unmodified: ⌘[ and ⌘] are the browser's history keys
  { action: "toggle-rail", key: "[", scope: "window" },
  { action: "toggle-panel", key: "]", scope: "window" },
  { action: "save-clipboard", key: "v", mod: true, scope: "paste" },
  { action: "move-left", key: "left", scope: "grid" },
  { action: "move-right", key: "right", scope: "grid" },
  { action: "move-up", key: "up", scope: "grid" },
  { action: "move-down", key: "down", scope: "grid" },
  { action: "extend-left", key: "left", scope: "grid", shift: true },
  { action: "extend-right", key: "right", scope: "grid", shift: true },
  { action: "extend-up", key: "up", scope: "grid", shift: true },
  { action: "extend-down", key: "down", scope: "grid", shift: true },
  { action: "move-first", key: "home", scope: "grid" },
  { action: "move-last", key: "end", scope: "grid" },
  { action: "open-item", key: "enter", scope: "grid" },
  { action: "quick-look", key: "space", scope: "grid" },
  { action: "clear-selection", key: "escape", scope: "grid" },
  { action: "select-all", key: "a", mod: true, scope: "grid" },
  { action: "delete-selection", key: "backspace", mod: true, scope: "grid" },
  { action: "back-to-library", key: "escape", scope: "item" },
];

// is-hotkey's spelling of an action's chord, which the palette and the rail's hints draw
export const hotkeyFor = (action: Shortcut["action"]): string | null => {
  const row = SHORTCUTS.find((shortcut) => shortcut.action === action);
  return row === undefined
    ? null
    : `${row.mod === true ? "mod+" : ""}${row.shift === true ? "shift+" : ""}${row.key}`;
};

export const bindingFor = (
  action: Shortcut["action"],
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

// Alt disqualifies outright; the modifier and shift each match only the rows that claim them. A
// key inside an IME composition is the composer's, so the Enter that commits a candidate opens
// nothing, and an unmodified key types where text is entered, so it answers only outside a field.
export const shortcutFor = <Scope extends ShortcutScope>(
  event: KeyboardEvent,
  scope: Scope,
  modifier: ShortcutModifier,
): ShortcutIn<Scope> | null => {
  if (event.altKey || isImeComposing({ nativeEvent: event })) {
    return null;
  }
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (foreign || (!claimed && isTextEntryTarget(event.target))) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    SHORTCUTS.find(
      (row): row is ShortcutIn<Scope> =>
        row.scope === scope &&
        eventKeyOf(row.key) === key &&
        (row.mod === true) === claimed &&
        (row.shift === true) === event.shiftKey,
    ) ?? null
  );
};

interface WindowShortcutOptions {
  modifier: ShortcutModifier;
  // off, the listener is detached: a chord the table claims reaches the page, or the browser
  enabled: boolean;
}

export const useWindowShortcuts = (
  { modifier, enabled }: WindowShortcutOptions,
  onShortcut: (action: ShortcutIn<"window">["action"]) => void,
): void => {
  const onAction = useEffectEvent(onShortcut);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcut = shortcutFor(event, "window", modifier);
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
