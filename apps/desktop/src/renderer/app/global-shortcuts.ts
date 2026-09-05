// a key both this table and `packages/editor/src/editor-shortcuts.ts` claim runs both.

import { useEffect, useLayoutEffect, useRef } from "react";

export type GlobalShortcutAction =
  | "open-action-composer"
  | "open-palette"
  | "find-in-note"
  | "open-daily-note"
  | "toggle-zen";

export interface GlobalShortcut {
  readonly key: string;
  readonly action: GlobalShortcutAction;
  readonly label: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { key: "k", action: "open-action-composer", label: "the action composer" },
  { key: "p", action: "open-palette", label: "the command palette" },
  { key: "f", action: "find-in-note", label: "find in the note" },
  { key: "d", action: "open-daily-note", label: "the daily note" },
  { key: "\\", action: "toggle-zen", label: "zen mode" },
];

export type ShortcutModifier = "meta" | "ctrl";

// never "either": on mac the editor's Ctrl-K is an emacs line kill, and both modifiers would double-fire.
export function platformShortcutModifier(): ShortcutModifier {
  return /mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl";
}

// shift and alt disqualify: ⌘⇧K is the editor's link insert.
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
