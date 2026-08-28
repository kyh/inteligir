// The window-level shortcuts, as a TABLE rather than an if/else chain inside
// the workspace. The editor binds its own keys
// (`packages/editor/src/editor-shortcuts.ts`) and neither side can see the
// other, so a key both tables claim runs BOTH — the palette opens AND the
// buffer is edited.
//
// Ownership rule: a shortcut listed here belongs to the APP, and the editor
// must not bind it.

import { useEffect, useLayoutEffect, useRef } from "react";

export type GlobalShortcutAction =
  | "open-action-composer"
  | "open-palette"
  | "open-daily-note"
  | "toggle-zen";

export interface GlobalShortcut {
  /** The letter, lowercase, held with the platform modifier and nothing else. */
  readonly key: string;
  readonly action: GlobalShortcutAction;
  /** Names the shortcut in the collision guard's failure message. */
  readonly label: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { key: "k", action: "open-action-composer", label: "the action composer" },
  { key: "p", action: "open-palette", label: "the command palette" },
  { key: "d", action: "open-daily-note", label: "the daily note" },
  { key: "\\", action: "toggle-zen", label: "zen mode" },
];

export type ShortcutModifier = "meta" | "ctrl";

/**
 * Which modifier the app claims: ⌘ on Apple platforms, Ctrl everywhere else —
 * EXCLUSIVELY, never "either". CodeMirror's mac keymap carries the emacs
 * bindings (Ctrl-K deletes to end of line, Ctrl-D deletes forward), so an app
 * that claimed both modifiers would open the palette on top of a line kill.
 */
export function platformShortcutModifier(): ShortcutModifier {
  return /mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl";
}

/**
 * Which shortcut this keydown is, or null. The other modifier, Shift and Alt
 * all DISQUALIFY: ⌘⇧K is the editor's link insert, and a matcher that ignored
 * the modifier would claim it too — the same double-fire read from the other
 * side.
 */
export function globalShortcutFor(
  event: KeyboardEvent,
  modifier: ShortcutModifier,
): GlobalShortcut | null {
  const claimed = modifier === "meta" ? event.metaKey : event.ctrlKey;
  const foreign = modifier === "meta" ? event.ctrlKey : event.metaKey;
  if (!claimed || foreign || event.shiftKey || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  return GLOBAL_SHORTCUTS.find((shortcut) => shortcut.key === key) ?? null;
}

/**
 * Installs the listener. The handler is read through a ref so a caller may
 * pass a fresh closure every render without re-subscribing the window.
 */
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
